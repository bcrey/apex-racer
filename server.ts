import dotenv from 'dotenv';
import express from 'express';
import {
  checkDatabaseHealth,
  DuplicateLapError,
  ensureLeaderboardTable,
  getLeaderboardData,
  isDirectSupabaseIpv6Error,
  isLeaderboardAdmin,
  issueLapToken,
  leaderboardAdminRefusal,
  parseLapSubmission,
  recordLapTime,
  resetLeaderboardData,
  sanitizeInitials,
} from './lib/leaderboard';
import { getFirstOpenSlot, getGridPlacement } from './src/track';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

const PORT = 3004;

type Player = {
  id: string;
  slotIndex: number;
  initials: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  color: string;
  lights?: boolean;
  z?: number;
  /** Players only see others on the same level. */
  level: string;
};

function queryTimeZone(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

async function startServer() {
  if (process.env.DATABASE_URL) {
    try {
      await ensureLeaderboardTable();
      console.log('Leaderboard database ready');
    } catch (error) {
      if (isDirectSupabaseIpv6Error(error)) {
        console.error(
          'Failed to initialize leaderboard database. This Supabase direct connection uses IPv6, but this environment cannot reach IPv6. Replace DATABASE_URL with the Supabase Session Pooler connection string from the Supabase dashboard Connect panel.',
        );
      } else {
        console.error('Failed to initialize leaderboard database', error);
      }
    }
  } else {
    console.warn('DATABASE_URL is not set. Leaderboard persistence is disabled.');
  }

  const app = express();
  app.use(express.json());
  let sendLeaderboardToClients: (() => void) | null = null;

  // API routes FIRST
  app.get('/api/health', async (_req, res) => {
    res.set('cache-control', 'no-store');
    try {
      const { laps } = await checkDatabaseHealth();
      res.json({ status: 'ok', database: 'ok', laps, checkedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Health check failed', error);
      res.status(503).json({ status: 'error', database: 'unreachable', checkedAt: new Date().toISOString() });
    }
  });

  // Marks the start of a lap by the server's clock; the lap's submission must carry it
  app.post('/api/lap-start', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ token: issueLapToken() });
  });

  app.get('/api/leaderboard', async (req, res) => {
    try {
      const leaderboard = await getLeaderboardData(queryTimeZone(req.query.timeZone));
      res.json({ leaderboard });
    } catch (error) {
      console.error('Unable to load leaderboard', error);
      res.status(500).json({ error: 'Unable to load leaderboard' });
    }
  });

  app.post('/api/leaderboard', async (req, res) => {
    const lap = parseLapSubmission(req.body);
    if ('error' in lap) {
      res.status(400).json({ error: lap.error });
      return;
    }

    try {
      const leaderboard = await recordLapTime(lap.initials, lap.timeMs, lap.timeZone, lap.lapToken);
      sendLeaderboardToClients?.();
      res.status(201).json({ leaderboard });
    } catch (error) {
      if (error instanceof DuplicateLapError) {
        res.status(409).json({ error: error.message });
        return;
      }
      console.error('Unable to save leaderboard entry', error);
      res.status(503).json({ error: 'Leaderboard unavailable' });
    }
  });

  app.delete('/api/leaderboard', async (req, res) => {
    if (!isLeaderboardAdmin(req.get('authorization'))) {
      const refusal = leaderboardAdminRefusal();
      res.status(refusal.status).json({ error: refusal.error });
      return;
    }

    try {
      const leaderboard = await resetLeaderboardData(queryTimeZone(req.query.timeZone));
      sendLeaderboardToClients?.();
      res.json({ leaderboard });
    } catch (error) {
      console.error('Unable to reset today leaderboard', error);
      res.status(503).json({ error: 'Unable to reset today leaderboard' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server });
  const players = new Map<string, Player>();

  const clientLevels = new WeakMap<WebSocket, string>();

  /** Sends to every open client, or only those on `level` when given. */
  const broadcast = (message: object, except?: WebSocket, level?: string) => {
    const payload = JSON.stringify(message);
    wss.clients.forEach((client) => {
      if (client !== except && client.readyState === WebSocket.OPEN && (!level || clientLevels.get(client) === level)) {
        client.send(payload);
      }
    });
  };
  sendLeaderboardToClients = () => broadcast({ type: 'leaderboard' });

  wss.on('connection', (ws, req) => {
    const id = Math.random().toString(36).substring(2, 9);
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const initials = sanitizeInitials(requestUrl.searchParams.get('initials'));
    const level = requestUrl.searchParams.get('level') === 'stunt' ? 'stunt' : 'circuit';
    clientLevels.set(ws, level);
    const levelPlayers = () => Array.from(players.values()).filter((other) => other.level === level);

    const { slotIndex, color, x, y } = getGridPlacement(
      getFirstOpenSlot(levelPlayers().map((other) => other.slotIndex)),
    );
    const player: Player = { id, slotIndex, initials, x, y, angle: 0, vx: 0, vy: 0, color, level };
    players.set(id, player);

    ws.send(JSON.stringify({
      type: 'init',
      id,
      color,
      initials,
      x,
      y,
      players: levelPlayers(),
    }));

    broadcast({ type: 'join', player }, ws, level);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          type?: string;
          x?: number;
          y?: number;
          angle?: number;
          vx?: number;
          vy?: number;
          lights?: boolean;
          z?: number;
        };

        if (msg.type !== 'update') {
          return;
        }

        player.x = msg.x ?? player.x;
        player.y = msg.y ?? player.y;
        player.angle = msg.angle ?? player.angle;
        player.vx = msg.vx ?? player.vx;
        player.vy = msg.vy ?? player.vy;
        player.lights = msg.lights ?? player.lights;
        player.z = msg.z ?? 0;

        broadcast({
          type: 'update',
          id,
          x: player.x,
          y: player.y,
          angle: player.angle,
          vx: player.vx,
          vy: player.vy,
          lights: player.lights,
          z: player.z,
        }, ws, level);
      } catch (error) {
        console.error('Message error', error);
      }
    });

    ws.on('close', () => {
      players.delete(id);
      broadcast({ type: 'leave', id }, undefined, level);
    });
  });
}

startServer();
