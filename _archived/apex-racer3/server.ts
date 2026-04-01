import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';

type PlayerState = {
  id: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  color: string;
};

const STARTING_LINE_X = -40;
const GRID_DEPTH_SPACING = 90;
const GRID_LANE_OFFSETS = [0, -90, 90, -180, 180];
const PLAYER_COLORS = [
  '#f97316',
  '#0ea5e9',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#ef4444',
  '#14b8a6',
  '#f43f5e',
];

function getSpawnPosition(players: PlayerState[]) {
  for (let slot = 0; slot < 40; slot++) {
    const row = Math.floor(slot / GRID_LANE_OFFSETS.length);
    const lane = GRID_LANE_OFFSETS[slot % GRID_LANE_OFFSETS.length];
    const candidate = {
      x: STARTING_LINE_X - row * GRID_DEPTH_SPACING,
      y: lane,
      angle: 0,
    };

    const occupied = players.some((player) => (
      Math.hypot(player.x - candidate.x, player.y - candidate.y) < 70
    ));

    if (!occupied) {
      return candidate;
    }
  }

  return {
    x: STARTING_LINE_X - players.length * GRID_DEPTH_SPACING,
    y: 0,
    angle: 0,
  };
}

function getPlayerColor(players: PlayerState[]) {
  const usedColors = new Set(players.map((player) => player.color));

  for (const color of PLAYER_COLORS) {
    if (!usedColors.has(color)) {
      return color;
    }
  }

  let attempt = players.length;
  while (true) {
    const color = `hsl(${(attempt * 47) % 360}, 80%, 55%)`;
    if (!usedColors.has(color)) {
      return color;
    }
    attempt++;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes FIRST
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
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
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // WebSocket Server
  const wss = new WebSocketServer({ server });
  const players = new Map<string, PlayerState>();

  wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(2, 9);
    const activePlayers = Array.from(players.values());
    const spawn = getSpawnPosition(activePlayers);
    const player: PlayerState = {
      id,
      x: spawn.x,
      y: spawn.y,
      angle: spawn.angle,
      vx: 0,
      vy: 0,
      color: getPlayerColor(activePlayers),
    };

    players.set(id, player);

    ws.send(JSON.stringify({ type: 'init', player, players: Array.from(players.values()) }));

    const joinMsg = JSON.stringify({ type: 'join', player });
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(joinMsg);
      }
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'update') {
          const p = players.get(id);
          if (p) {
            p.x = msg.x;
            p.y = msg.y;
            p.angle = msg.angle;
            p.vx = msg.vx;
            p.vy = msg.vy;
            
            const updateMsg = JSON.stringify({ type: 'update', id, x: p.x, y: p.y, angle: p.angle, vx: p.vx, vy: p.vy });
            wss.clients.forEach(client => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(updateMsg);
              }
            });
          }
        }
      } catch (e) {
        console.error('Message error', e);
      }
    });

    ws.on('close', () => {
      players.delete(id);
      const leaveMsg = JSON.stringify({ type: 'leave', id });
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(leaveMsg);
        }
      });
    });
  });
}

startServer();
