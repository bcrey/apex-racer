import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const PORT = Number(process.env.PORT || (fs.existsSync(distDir) ? 3000 : 3001));
const ROOM_CAPACITY = 2;
const ROOM_TTL_MS = 60_000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PLAYER_LANES = [-72, 72];
const PLAYER_STYLES = ['apex', 'solaris'];

const rooms = new Map();
const app = express();

app.use(express.json());

function clampNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function createRoomCode() {
  let roomCode = '';
  for (let i = 0; i < 5; i += 1) {
    roomCode += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return roomCode;
}

function getRoom(code) {
  return rooms.get(String(code || '').trim().toUpperCase());
}

function createDefaultSnapshot(playerId, playerIndex) {
  return {
    playerId,
    playerIndex,
    style: PLAYER_STYLES[playerIndex] || PLAYER_STYLES[0],
    x: 0,
    y: PLAYER_LANES[playerIndex] ?? 0,
    vx: 0,
    vy: 0,
    angle: 0,
    speedKmh: 0,
    lap: 1,
    lapTime: 0,
    bestLap: null,
    connected: true,
    updatedAt: Date.now(),
  };
}

function createRoom(code) {
  return {
    code,
    players: new Map(),
    clients: new Set(),
  };
}

function getAvailablePlayerIndex(room) {
  const occupiedIndices = new Set(
    Array.from(room.players.values()).map((player) => player.playerIndex),
  );

  for (let index = 0; index < ROOM_CAPACITY; index += 1) {
    if (!occupiedIndices.has(index)) {
      return index;
    }
  }

  return -1;
}

function serializeRoom(room) {
  const connectedAfter = Date.now() - 5_000;
  return {
    roomCode: room.code,
    players: Array.from(room.players.values())
      .sort((left, right) => left.playerIndex - right.playerIndex)
      .map((player) => ({
        ...player.snapshot,
        playerId: player.playerId,
        playerIndex: player.playerIndex,
        style: PLAYER_STYLES[player.playerIndex] || PLAYER_STYLES[0],
        connected: player.lastSeenAt >= connectedAfter,
        updatedAt: player.lastSeenAt,
      })),
  };
}

function broadcastRoom(room) {
  if (!room || room.clients.size === 0) {
    return;
  }

  const payload = `data: ${JSON.stringify(serializeRoom(room))}\n\n`;
  for (const client of room.clients) {
    client.write(payload);
  }
}

function pruneStalePlayers() {
  const staleBefore = Date.now() - ROOM_TTL_MS;
  for (const [roomCode, room] of rooms.entries()) {
    let changed = false;
    for (const [playerId, player] of room.players.entries()) {
      if (player.lastSeenAt < staleBefore) {
        room.players.delete(playerId);
        changed = true;
      }
    }

    if (room.players.size === 0) {
      for (const client of room.clients) {
        client.end();
      }
      rooms.delete(roomCode);
      continue;
    }

    if (changed) {
      broadcastRoom(room);
    }
  }
}

function sanitizeSnapshot(player, snapshot) {
  const previous = player.snapshot;
  return {
    playerId: player.playerId,
    playerIndex: player.playerIndex,
    style: PLAYER_STYLES[player.playerIndex] || PLAYER_STYLES[0],
    x: clampNumber(snapshot?.x, previous.x),
    y: clampNumber(snapshot?.y, previous.y),
    vx: clampNumber(snapshot?.vx, previous.vx),
    vy: clampNumber(snapshot?.vy, previous.vy),
    angle: clampNumber(snapshot?.angle, previous.angle),
    speedKmh: Math.max(0, Math.round(clampNumber(snapshot?.speedKmh, previous.speedKmh))),
    lap: Math.max(1, Math.round(clampNumber(snapshot?.lap, previous.lap))),
    lapTime: Math.max(0, clampNumber(snapshot?.lapTime, previous.lapTime)),
    bestLap:
      snapshot?.bestLap === null || snapshot?.bestLap === undefined
        ? previous.bestLap
        : Math.max(0, clampNumber(snapshot.bestLap, previous.bestLap ?? 0)),
    connected: true,
    updatedAt: Date.now(),
  };
}

app.get('/api/health', (_request, response) => {
  response.json({ok: true});
});

app.post('/api/rooms', (_request, response) => {
  let roomCode = createRoomCode();
  while (rooms.has(roomCode)) {
    roomCode = createRoomCode();
  }

  const room = createRoom(roomCode);
  const playerId = crypto.randomUUID();
  const playerIndex = 0;

  room.players.set(playerId, {
    playerId,
    playerIndex,
    snapshot: createDefaultSnapshot(playerId, playerIndex),
    lastSeenAt: Date.now(),
  });

  rooms.set(roomCode, room);

  response.json({
    roomCode,
    playerId,
    playerIndex,
    players: serializeRoom(room).players,
  });
});

app.post('/api/rooms/:roomCode/join', (request, response) => {
  const room = getRoom(request.params.roomCode);
  if (!room) {
    response.status(404).json({error: 'That room does not exist.'});
    return;
  }

  const playerIndex = getAvailablePlayerIndex(room);
  if (playerIndex === -1) {
    response.status(409).json({error: 'That room already has two racers.'});
    return;
  }

  const playerId = crypto.randomUUID();
  room.players.set(playerId, {
    playerId,
    playerIndex,
    snapshot: createDefaultSnapshot(playerId, playerIndex),
    lastSeenAt: Date.now(),
  });

  broadcastRoom(room);

  response.json({
    roomCode: room.code,
    playerId,
    playerIndex,
    players: serializeRoom(room).players,
  });
});

app.post('/api/rooms/:roomCode/sync', (request, response) => {
  const room = getRoom(request.params.roomCode);
  if (!room) {
    response.status(404).json({error: 'The room could not be found.'});
    return;
  }

  const player = room.players.get(request.body?.playerId);
  if (!player) {
    response.status(404).json({error: 'That player is no longer in the room.'});
    return;
  }

  player.snapshot = sanitizeSnapshot(player, request.body?.snapshot);
  player.lastSeenAt = Date.now();

  broadcastRoom(room);

  response.json({ok: true});
});

app.post('/api/rooms/:roomCode/leave', (request, response) => {
  const room = getRoom(request.params.roomCode);
  if (!room) {
    response.json({ok: true});
    return;
  }

  room.players.delete(request.body?.playerId);

  if (room.players.size === 0) {
    for (const client of room.clients) {
      client.end();
    }
    rooms.delete(room.code);
    response.json({ok: true});
    return;
  }

  broadcastRoom(room);
  response.json({ok: true});
});

app.get('/api/rooms/:roomCode/events', (request, response) => {
  const room = getRoom(request.params.roomCode);
  const playerId = String(request.query.playerId || '');
  const player = room?.players.get(playerId);

  if (!room || !player) {
    response.status(404).end();
    return;
  }

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders?.();

  room.clients.add(response);
  response.write('retry: 1500\n\n');
  response.write(`data: ${JSON.stringify(serializeRoom(room))}\n\n`);

  const heartbeat = setInterval(() => {
    response.write(': ping\n\n');
  }, 10_000);

  request.on('close', () => {
    clearInterval(heartbeat);
    room.clients.delete(response);
  });
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api/')) {
      next();
      return;
    }

    response.sendFile(path.join(distDir, 'index.html'));
  });
}

setInterval(pruneStalePlayers, 10_000).unref();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Multiplayer server listening on http://0.0.0.0:${PORT}`);
});
