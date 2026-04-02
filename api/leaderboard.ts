import {
  ensureLeaderboardTable,
  getTopLapTimes,
  hasLeaderboardDatabase,
  isDirectSupabaseIpv6Error,
  recordLapTime,
  sanitizeInitials,
} from '../lib/leaderboard';

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

export async function GET() {
  if (!hasLeaderboardDatabase()) {
    return json({ error: 'DATABASE_URL is not configured on Vercel.' }, { status: 503 });
  }

  try {
    await ensureLeaderboardTable();
    const entries = await getTopLapTimes();
    return json({ entries });
  } catch (error) {
    console.error('Unable to load leaderboard', error);

    if (isDirectSupabaseIpv6Error(error)) {
      return json(
        { error: 'DATABASE_URL must use the Supabase Session Pooler URL on Vercel.' },
        { status: 503 },
      );
    }

    return json({ error: 'Unable to load leaderboard' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasLeaderboardDatabase()) {
    return json({ error: 'DATABASE_URL is not configured on Vercel.' }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { initials?: string; timeMs?: number } | null;
  const initials = sanitizeInitials(body?.initials);
  const timeMs = Math.round(Number(body?.timeMs));

  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    return json({ error: 'A valid lap time is required' }, { status: 400 });
  }

  try {
    await ensureLeaderboardTable();
    const entries = await recordLapTime(initials, timeMs);
    return json({ entries }, { status: 201 });
  } catch (error) {
    console.error('Unable to save leaderboard entry', error);

    if (isDirectSupabaseIpv6Error(error)) {
      return json(
        { error: 'DATABASE_URL must use the Supabase Session Pooler URL on Vercel.' },
        { status: 503 },
      );
    }

    return json({ error: 'Leaderboard unavailable' }, { status: 503 });
  }
}
