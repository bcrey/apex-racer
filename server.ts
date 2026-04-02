import dotenv from 'dotenv';
import express from 'express';
import {
  ensureLeaderboardTable,
  getTopLapTimes,
  isDirectSupabaseIpv6Error,
  recordLapTime,
  sanitizeInitials,
  type LeaderboardEntry,
} from './lib/leaderboard';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

const START_FINISH_X = 900;
const STARTING_GRID_OFFSET = 140;
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
};

const colors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#14b8a6'];

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
  let sendLeaderboardToClients: ((entries: LeaderboardEntry[]) => void) | null = null;

  // API routes FIRST
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/leaderboard', async (_req, res) => {
    try {
      const entries = await getTopLapTimes();
      res.json({ entries });
    } catch (error) {
      console.error('Unable to load leaderboard', error);
      res.status(500).json({ error: 'Unable to load leaderboard' });
    }
  });

  app.post('/api/leaderboard', async (req, res) => {
    const initials = sanitizeInitials(req.body?.initials);
    const timeMs = Math.round(Number(req.body?.timeMs));

    if (!Number.isFinite(timeMs) || timeMs <= 0) {
      res.status(400).json({ error: 'A valid lap time is required' });
      return;
    }

    try {
      const entries = await recordLapTime(initials, timeMs);
      sendLeaderboardToClients?.(entries);
      res.status(201).json({ entries });
    } catch (error) {
      console.error('Unable to save leaderboard entry', error);
      res.status(503).json({ error: 'Leaderboard unavailable' });
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
  sendLeaderboardToClients = (entries) => {
    const leaderboardMsg = JSON.stringify({ type: 'leaderboard', entries });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(leaderboardMsg);
      }
    });
  };

  wss.on('connection', (ws, req) => {
    const id = Math.random().toString(36).substring(2, 9);
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const initials = sanitizeInitials(requestUrl.searchParams.get('initials'));

    const usedSlots = new Set(Array.from(players.values()).map((player) => player.slotIndex));
    let slotIndex = 0;
    while (usedSlots.has(slotIndex)) {
      slotIndex++;
    }

    const color = colors[slotIndex % colors.length];
    const startX = START_FINISH_X - STARTING_GRID_OFFSET - Math.floor(slotIndex / 2) * 120;
    const startY = (slotIndex % 2 === 0) ? -80 : 80;

    players.set(id, { id, slotIndex, initials, x: startX, y: startY, angle: 0, vx: 0, vy: 0, color });

    ws.send(JSON.stringify({
      type: 'init',
      id,
      color,
      initials,
      x: startX,
      y: startY,
      players: Array.from(players.values()),
    }));

    const joinMsg = JSON.stringify({ type: 'join', player: players.get(id) });
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(joinMsg);
      }
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          type?: string;
          x?: number;
          y?: number;
          angle?: number;
          vx?: number;
          vy?: number;
        };

        if (msg.type !== 'update') {
          return;
        }

        const player = players.get(id);
        if (!player) {
          return;
        }

        player.x = msg.x ?? player.x;
        player.y = msg.y ?? player.y;
        player.angle = msg.angle ?? player.angle;
        player.vx = msg.vx ?? player.vx;
        player.vy = msg.vy ?? player.vy;

        const updateMsg = JSON.stringify({
          type: 'update',
          id,
          x: player.x,
          y: player.y,
          angle: player.angle,
          vx: player.vx,
          vy: player.vy,
        });

        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(updateMsg);
          }
        });
      } catch (error) {
        console.error('Message error', error);
      }
    });

    ws.on('close', () => {
      players.delete(id);
      const leaveMsg = JSON.stringify({ type: 'leave', id });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(leaveMsg);
        }
      });
    });
  });
}

startServer();
