import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = 3004;

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
  const players = new Map<string, any>();
  const colors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#14b8a6'];

  wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(2, 9);
    
    const usedSlots = new Set(Array.from(players.values()).map(p => p.slotIndex));
    let slotIndex = 0;
    while (usedSlots.has(slotIndex)) {
      slotIndex++;
    }

    const color = colors[slotIndex % colors.length];
    const startX = -Math.floor(slotIndex / 2) * 120;
    const startY = (slotIndex % 2 === 0) ? -80 : 80;
    
    players.set(id, { id, slotIndex, x: startX, y: startY, angle: 0, vx: 0, vy: 0, color });

    ws.send(JSON.stringify({ type: 'init', id, color, x: startX, y: startY, players: Array.from(players.values()) }));

    const joinMsg = JSON.stringify({ type: 'join', player: players.get(id) });
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
