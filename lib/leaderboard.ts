import postgres from 'postgres';

export type LeaderboardEntry = {
  initials: string;
  timeMs: number;
};

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
  const cleaned = (value ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return cleaned || '???';
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

export async function getTopLapTimes() {
  const sql = getSqlClient();
  if (!sql) {
    return [] as LeaderboardEntry[];
  }

  await ensureLeaderboardTable();

  const rows = await sql<LeaderboardEntry[]>`
    select initials, time_ms as "timeMs"
    from leaderboard_laps
    order by time_ms asc, created_at asc
    limit 3
  `;

  return rows;
}

export async function recordLapTime(initials: string, timeMs: number) {
  const sql = getSqlClient();
  if (!sql) {
    throw new Error('Leaderboard database is not configured');
  }

  await ensureLeaderboardTable();

  await sql`
    insert into leaderboard_laps (initials, time_ms)
    values (${initials}, ${timeMs})
  `;

  return getTopLapTimes();
}
