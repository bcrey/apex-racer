import { checkDatabaseHealth } from '../lib/leaderboard.js';

export const runtime = 'nodejs';

// Uptime monitor target: 200 only when the app is up and the database answers
export default {
  async fetch() {
    const started = Date.now();
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };

    try {
      const { laps } = await checkDatabaseHealth();
      return new Response(
        JSON.stringify({ status: 'ok', database: 'ok', laps, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() }),
        { headers },
      );
    } catch (error) {
      console.error('Health check failed', error);
      return new Response(
        JSON.stringify({ status: 'error', database: 'unreachable', checkedAt: new Date().toISOString() }),
        { status: 503, headers },
      );
    }
  },
};
