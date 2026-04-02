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

async function loadLeaderboard() {
  try {
    const leaderboard = await import('../lib/leaderboard');

    if (!leaderboard.hasLeaderboardDatabase()) {
      return json({ error: 'DATABASE_URL is not configured on Vercel.' }, { status: 503 });
    }

    await leaderboard.ensureLeaderboardTable();
    const entries = await leaderboard.getTopLapTimes();
    return json({ entries });
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
  const body = await request.json().catch(() => null) as { initials?: string; timeMs?: number } | null;
  const timeMs = Math.round(Number(body?.timeMs));

  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    return json({ error: 'A valid lap time is required' }, { status: 400 });
  }

  try {
    const leaderboard = await import('../lib/leaderboard');

    if (!leaderboard.hasLeaderboardDatabase()) {
      return json({ error: 'DATABASE_URL is not configured on Vercel.' }, { status: 503 });
    }

    const initials = leaderboard.sanitizeInitials(body?.initials);

    await leaderboard.ensureLeaderboardTable();
    const entries = await leaderboard.recordLapTime(initials, timeMs);
    return json({ entries }, { status: 201 });
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

export default {
  async fetch(request: Request) {
    if (request.method === 'GET') {
      return loadLeaderboard();
    }

    if (request.method === 'POST') {
      return saveLeaderboard(request);
    }

    return json(
      { error: `Method ${request.method} not allowed` },
      {
        status: 405,
        headers: {
          Allow: 'GET, POST',
        },
      },
    );
  },
};
