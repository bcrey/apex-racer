import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import {
  emptyLeaderboardData,
  LEADERBOARD_LIMIT,
  MIN_LAP_MS,
  normalizeInitials,
  type LeaderboardData,
  type LeaderboardEntry,
} from './leaderboardShared.js';

export type { LeaderboardData, LeaderboardEntry };

let sqlClient: postgres.Sql | null | undefined;
let leaderboardReadyPromise: Promise<void> | null = null;

export function hasLeaderboardDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

function createSqlClient(databaseUrl: string) {
  const match = databaseUrl.match(/^postgres(?:ql)?:\/\/([^:]+):(.+)@([^:/]+):(\d+)\/(.+)$/);
  if (!match) {
    throw new Error('DATABASE_URL format is invalid');
  }

  const [, username, password, host, port, databasePath] = match;
  const [database] = databasePath.split('?');
  const numericPort = Number(port);
  const isSupabaseTransactionPooler = host.includes('.pooler.supabase.com') && numericPort === 6543;

  return postgres({
    host,
    port: numericPort,
    database,
    username,
    password,
    ssl: 'require',
    prepare: !isSupabaseTransactionPooler,
    // Serverless instances stay warm between requests; hold few connections
    // and let idle ones go so they do not exhaust the Supabase pooler.
    max: 2,
    idle_timeout: 20,
  });
}

function getSqlClient() {
  if (sqlClient !== undefined) {
    return sqlClient;
  }

  sqlClient = process.env.DATABASE_URL
    ? createSqlClient(process.env.DATABASE_URL)
    : null;

  return sqlClient;
}

export function sanitizeInitials(value: string | null | undefined) {
  return normalizeInitials(value) || '???';
}

export function sanitizeTimeZone(value: string | null | undefined) {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : 'UTC';

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

export function isDirectSupabaseIpv6Error(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EHOSTUNREACH' &&
    process.env.DATABASE_URL?.includes('.supabase.co:5432')
  );
}

export async function ensureLeaderboardTable() {
  const sql = getSqlClient();
  if (!sql) {
    return;
  }

  if (!leaderboardReadyPromise) {
    leaderboardReadyPromise = (async () => {
      await sql`
        create table if not exists leaderboard_laps (
          id bigserial primary key,
          initials varchar(3) not null,
          time_ms integer not null check (time_ms > 0),
          created_at timestamptz not null default now()
        )
      `;

      await sql`
        create table if not exists leaderboard_daily_resets (
          time_zone text primary key,
          reset_at timestamptz not null default now()
        )
      `;

      await sql`
        create index if not exists leaderboard_laps_time_ms_idx
        on leaderboard_laps (time_ms asc, created_at asc)
      `;

      // Each lap-start token can be spent on one lap only
      await sql`
        alter table leaderboard_laps add column if not exists lap_token text
      `;

      await sql`
        create unique index if not exists leaderboard_laps_lap_token_idx
        on leaderboard_laps (lap_token)
      `;
    })();
  }

  try {
    await leaderboardReadyPromise;
  } catch (error) {
    leaderboardReadyPromise = null;
    throw error;
  }
}

// A lap may arrive this much sooner after its start token than the time it
// claims. Covers a slow lap-start request (a cold serverless start, a phone
// radio waking up) against a quick submission.
export const LAP_TOKEN_TOLERANCE_MS = 3000;
// No lap takes this long; older tokens are refused.
const LAP_TOKEN_MAX_AGE_MS = 30 * 60 * 1000;

let fallbackLapSecret: Buffer | null = null;

function lapTokenSecret() {
  const configured = process.env.LEADERBOARD_SECRET?.trim();
  if (configured) {
    return configured;
  }

  // Serverless instances need a secret they all share. The database URL is
  // already secret and the same on every instance, so derive one from it.
  if (process.env.DATABASE_URL) {
    return createHash('sha256').update(`apex-racer-lap-token:${process.env.DATABASE_URL}`).digest();
  }

  // No database means no leaderboard to protect; any per-process secret will do
  fallbackLapSecret ??= randomBytes(32);
  return fallbackLapSecret;
}

function signLapToken(payload: string) {
  return createHmac('sha256', lapTokenSecret()).update(payload).digest('base64url');
}

/** A signed record of when a lap started, by the server's clock. */
export function issueLapToken(now = Date.now()) {
  const payload = `${now}.${randomBytes(6).toString('base64url')}`;
  return `${payload}.${signLapToken(payload)}`;
}

/** When a lap token was issued, or null if it is malformed or not signed by us. */
export function readLapToken(token: unknown) {
  if (typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const expected = Buffer.from(signLapToken(`${parts[0]}.${parts[1]}`));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  const issuedAt = Number(parts[0]);
  return Number.isSafeInteger(issuedAt) ? issuedAt : null;
}

/**
 * Validates a POST body from either server; the error is the 400 message.
 * Besides the time itself, the lap must carry the token the server issued
 * when it started, and must arrive no sooner than the claimed time after it.
 * Each token counts once (recordLapTime enforces that), so faking a lap means
 * really waiting out the claimed time, and it can never beat MIN_LAP_MS.
 */
export function parseLapSubmission(
  body: { initials?: unknown; timeMs?: unknown; timeZone?: unknown; lapToken?: unknown } | null | undefined,
  now = Date.now(),
) {
  const timeMs = Math.round(Number(body?.timeMs));
  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    return { error: 'A valid lap time is required' } as const;
  }

  if (timeMs < MIN_LAP_MS) {
    return { error: 'Lap time is faster than the track allows' } as const;
  }

  const startedAt = readLapToken(body?.lapToken);
  if (startedAt === null) {
    return { error: 'A valid lap token is required' } as const;
  }

  const elapsedMs = now - startedAt;
  if (elapsedMs > LAP_TOKEN_MAX_AGE_MS) {
    return { error: 'Lap token has expired' } as const;
  }

  if (elapsedMs < timeMs - LAP_TOKEN_TOLERANCE_MS) {
    return { error: 'Lap submitted before that much time had passed' } as const;
  }

  return {
    initials: sanitizeInitials(typeof body?.initials === 'string' ? body.initials : undefined),
    timeMs,
    timeZone: typeof body?.timeZone === 'string' ? body.timeZone : undefined,
    lapToken: body?.lapToken as string,
  };
}

/** True when the Authorization header carries LEADERBOARD_ADMIN_TOKEN. Always false if that is unset. */
export function isLeaderboardAdmin(authorization: string | null | undefined) {
  const expected = process.env.LEADERBOARD_ADMIN_TOKEN?.trim();
  const provided = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!expected || !provided) {
    return false;
  }

  // Compare digests so the check takes the same time whatever the length
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

/** Why a reset was refused: 403 when resets are switched off, 401 for a wrong token. */
export function leaderboardAdminRefusal() {
  return process.env.LEADERBOARD_ADMIN_TOKEN?.trim()
    ? { status: 401, error: 'Admin token required' }
    : { status: 403, error: 'Leaderboard reset is disabled. Set LEADERBOARD_ADMIN_TOKEN to enable it.' };
}

export async function getLeaderboardData(timeZone: string | null | undefined) {
  const sql = getSqlClient();
  if (!sql) {
    return emptyLeaderboardData();
  }

  await ensureLeaderboardTable();
  const safeTimeZone = sanitizeTimeZone(timeZone);

  const [allTime, today] = await Promise.all([
    sql<LeaderboardEntry[]>`
      select initials, time_ms as "timeMs"
      from leaderboard_laps
      order by time_ms asc, created_at asc
      limit ${LEADERBOARD_LIMIT}
    `,
    sql<LeaderboardEntry[]>`
      select initials, time_ms as "timeMs"
      from leaderboard_laps
      where (created_at at time zone ${safeTimeZone})::date = (now() at time zone ${safeTimeZone})::date
        and created_at > coalesce(
          (
            select reset_at
            from leaderboard_daily_resets
            where time_zone = ${safeTimeZone}
          ),
          '-infinity'::timestamptz
        )
      order by time_ms asc, created_at asc
      limit ${LEADERBOARD_LIMIT}
    `,
  ]);

  return {
    allTime,
    today,
  } satisfies LeaderboardData;
}

/** Thrown by recordLapTime when a lap token has already been spent. */
export class DuplicateLapError extends Error {
  constructor() {
    super('This lap has already been submitted');
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export async function recordLapTime(
  initials: string,
  timeMs: number,
  timeZone: string | null | undefined,
  lapToken: string,
) {
  const sql = getSqlClient();
  if (!sql) {
    throw new Error('Leaderboard database is not configured');
  }

  await ensureLeaderboardTable();

  try {
    await sql`
      insert into leaderboard_laps (initials, time_ms, lap_token)
      values (${initials}, ${timeMs}, ${lapToken})
    `;
  } catch (error) {
    throw isUniqueViolation(error) ? new DuplicateLapError() : error;
  }

  return getLeaderboardData(timeZone);
}

export async function resetLeaderboardData(timeZone: string | null | undefined) {
  const sql = getSqlClient();
  if (!sql) {
    throw new Error('Leaderboard database is not configured');
  }

  await ensureLeaderboardTable();
  const safeTimeZone = sanitizeTimeZone(timeZone);

  await sql`
    insert into leaderboard_daily_resets (time_zone, reset_at)
    values (${safeTimeZone}, now())
    on conflict (time_zone)
    do update set reset_at = excluded.reset_at
  `;

  return getLeaderboardData(timeZone);
}
