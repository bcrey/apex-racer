import postgres from 'postgres';
import {
  emptyLeaderboardData,
  LEADERBOARD_LIMIT,
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
    })();
  }

  try {
    await leaderboardReadyPromise;
  } catch (error) {
    leaderboardReadyPromise = null;
    throw error;
  }
}

/** Validates a POST body from either server; the error is the 400 message. */
export function parseLapSubmission(body: { initials?: unknown; timeMs?: unknown; timeZone?: unknown } | null | undefined) {
  const timeMs = Math.round(Number(body?.timeMs));
  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    return { error: 'A valid lap time is required' } as const;
  }

  return {
    initials: sanitizeInitials(typeof body?.initials === 'string' ? body.initials : undefined),
    timeMs,
    timeZone: typeof body?.timeZone === 'string' ? body.timeZone : undefined,
  };
}

/**
 * Reads the database for health checks. A real query on a real table counts
 * as activity, which keeps a free Supabase project from pausing when idle.
 */
export async function checkDatabaseHealth() {
  const sql = getSqlClient();
  if (!sql) {
    throw new Error('Leaderboard database is not configured');
  }

  await ensureLeaderboardTable();
  const [{ laps }] = await sql<{ laps: number }[]>`
    select count(*)::int as laps from leaderboard_laps
  `;
  return { laps };
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

export async function recordLapTime(initials: string, timeMs: number, timeZone: string | null | undefined) {
  const sql = getSqlClient();
  if (!sql) {
    throw new Error('Leaderboard database is not configured');
  }

  await ensureLeaderboardTable();

  await sql`
    insert into leaderboard_laps (initials, time_ms)
    values (${initials}, ${timeMs})
  `;

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
