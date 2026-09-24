import { issueLapToken } from '../lib/leaderboard.js';

export const runtime = 'nodejs';

// Marks the start of a lap by the server's clock; the lap's submission to
// /api/leaderboard must carry this token.
export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: `Method ${request.method} not allowed` }), {
        status: 405,
        headers: { 'content-type': 'application/json', Allow: 'POST' },
      });
    }

    return new Response(JSON.stringify({ token: issueLapToken() }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  },
};
