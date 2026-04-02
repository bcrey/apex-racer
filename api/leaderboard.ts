import {
  ensureLeaderboardTable,
  getLeaderboardData,
  hasLeaderboardDatabase,
  recordLapTime,
  resetLeaderboardData,
  sanitizeInitials,
  sanitizeTimeZone,
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

async function loadLeaderboard(request: Request) {
  try {
    if (!hasLeaderboardDatabase()) {
      return json({ error: 'DATABASE_URL is not configured on Vercel.' }, { status: 503 });
    }

    await ensureLeaderboardTable();
    const requestUrl = new URL(request.url);
    const leaderboard = await getLeaderboardData(sanitizeTimeZone(requestUrl.searchParams.get('timeZone')));
    return json({ leaderboard });
  } catch (error) {
    console.error('Unable to load leaderboard', error);

    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EHOSTUNREACH' &&
      process.env.DATABASE_URL?.includes('.supabase.co:5432')
    ) {
      return json(
        { error: 'DATABASE_URL must use the Supabase Session Pooler URL on Vercel.' },
        { status: 503 },
      );
    }

    return json({ error: 'Unable to load leaderboard' }, { status: 500 });
  }
}

async function saveLeaderboard(request: Request) {
  const body = await request.json().catch(() => null) as { initials?: string; timeMs?: number; timeZone?: string } | null;
  const timeMs = Math.round(Number(body?.timeMs));

  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    return json({ error: 'A valid lap time is required' }, { status: 400 });
  }

  try {
    if (!hasLeaderboardDatabase()) {
      return json({ error: 'DATABASE_URL is not configured on Vercel.' }, { status: 503 });
    }

    const initials = sanitizeInitials(body?.initials);
    const timeZone = sanitizeTimeZone(body?.timeZone);

    await ensureLeaderboardTable();
    const leaderboard = await recordLapTime(initials, timeMs, timeZone);
    return json({ leaderboard }, { status: 201 });
  } catch (error) {
    console.error('Unable to save leaderboard entry', error);

    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EHOSTUNREACH' &&
      process.env.DATABASE_URL?.includes('.supabase.co:5432')
    ) {
      return json(
        { error: 'DATABASE_URL must use the Supabase Session Pooler URL on Vercel.' },
        { status: 503 },
      );
    }

    return json({ error: 'Leaderboard unavailable' }, { status: 503 });
  }
}

async function clearLeaderboard(request: Request) {
  try {
    if (!hasLeaderboardDatabase()) {
      return json({ error: 'DATABASE_URL is not configured on Vercel.' }, { status: 503 });
    }

    const requestUrl = new URL(request.url);
    const timeZone = sanitizeTimeZone(requestUrl.searchParams.get('timeZone'));

    await ensureLeaderboardTable();
    const leaderboard = await resetLeaderboardData(timeZone);
    return json({ leaderboard });
  } catch (error) {
    console.error('Unable to reset today leaderboard', error);

    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EHOSTUNREACH' &&
      process.env.DATABASE_URL?.includes('.supabase.co:5432')
    ) {
      return json(
        { error: 'DATABASE_URL must use the Supabase Session Pooler URL on Vercel.' },
        { status: 503 },
      );
    }

    return json({ error: 'Unable to reset today leaderboard' }, { status: 500 });
  }
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
