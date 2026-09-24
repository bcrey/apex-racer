import {
  getLeaderboardData,
  hasLeaderboardDatabase,
  isDirectSupabaseIpv6Error,
  parseLapSubmission,
  recordLapTime,
  resetLeaderboardData,
} from '../lib/leaderboard.js';

export const runtime = 'nodejs';

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
}

/** Runs a database-backed handler with the shared "not configured" and error responses. */
async function withDatabase(
  failure: { log: string; message: string; status: number },
  run: () => Promise<Response>,
) {
  if (!hasLeaderboardDatabase()) {
    return json({ error: 'DATABASE_URL is not configured on Vercel.' }, { status: 503 });
  }

  try {
    return await run();
  } catch (error) {
    console.error(failure.log, error);

    if (isDirectSupabaseIpv6Error(error)) {
      return json(
        { error: 'DATABASE_URL must use the Supabase Session Pooler URL on Vercel.' },
        { status: 503 },
      );
    }

    return json({ error: failure.message }, { status: failure.status });
  }
}

function timeZoneParam(request: Request) {
  return new URL(request.url).searchParams.get('timeZone');
}

function loadLeaderboard(request: Request) {
  return withDatabase(
    { log: 'Unable to load leaderboard', message: 'Unable to load leaderboard', status: 500 },
    async () => json({ leaderboard: await getLeaderboardData(timeZoneParam(request)) }),
  );
}

async function saveLeaderboard(request: Request) {
  const lap = parseLapSubmission(await request.json().catch(() => null));
  if ('error' in lap) {
    return json({ error: lap.error }, { status: 400 });
  }

  return withDatabase(
    { log: 'Unable to save leaderboard entry', message: 'Leaderboard unavailable', status: 503 },
    async () => json({ leaderboard: await recordLapTime(lap.initials, lap.timeMs, lap.timeZone) }, { status: 201 }),
  );
}

function clearLeaderboard(request: Request) {
  return withDatabase(
    { log: 'Unable to reset today leaderboard', message: 'Unable to reset today leaderboard', status: 500 },
    async () => json({ leaderboard: await resetLeaderboardData(timeZoneParam(request)) }),
  );
}

export default {
  async fetch(request: Request) {
    if (request.method === 'GET') {
      return loadLeaderboard(request);
    }

    if (request.method === 'POST') {
      return saveLeaderboard(request);
    }

    if (request.method === 'DELETE') {
      return clearLeaderboard(request);
    }

    return json(
      { error: `Method ${request.method} not allowed` },
      {
        status: 405,
        headers: {
          Allow: 'GET, POST, DELETE',
        },
      },
    );
  },
};
