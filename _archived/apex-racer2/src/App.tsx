import React, {useEffect, useRef, useState} from 'react';

type Vec = {x: number; y: number};
type CarStyle = 'apex' | 'solaris';

type CarState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
};

type HudState = {
  speedKmh: number;
  lap: number;
  lapTime: number;
  bestLap: number | null;
};

type PlayerSnapshot = CarState &
  HudState & {
    playerId: string;
    playerIndex: number;
    style: CarStyle;
    connected: boolean;
    updatedAt: number;
  };

type RemoteRenderState = PlayerSnapshot & {
  renderX: number;
  renderY: number;
  renderAngle: number;
};

type RoomSyncPayload = {
  roomCode: string;
  players: PlayerSnapshot[];
};

type SessionResponse = {
  roomCode: string;
  playerId: string;
  playerIndex: number;
  players: PlayerSnapshot[];
};

type MultiplayerSession = {
  roomCode: string;
  playerId: string;
  playerIndex: number;
  eventSource: EventSource | null;
  lastSyncAt: number;
  syncInFlight: boolean;
};

type SkidMark = {x: number; y: number; life: number};

function sqr(x: number) {
  return x * x;
}

function dist2(v: Vec, w: Vec) {
  return sqr(v.x - w.x) + sqr(v.y - w.y);
}

function distToSegmentSquared(p: Vec, v: Vec, w: Vec) {
  const l2 = dist2(v, w);
  if (l2 === 0) {
    return dist2(p, v);
  }

  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));

  return dist2(p, {
    x: v.x + t * (w.x - v.x),
    y: v.y + t * (w.y - v.y),
  });
}

const TRACK_POINTS = [
  {x: 0, y: 0},
  {x: 1500, y: 0},
  {x: 2000, y: 500},
  {x: 2000, y: 1500},
  {x: 1000, y: 1500},
  {x: 500, y: 2000},
  {x: 500, y: 2500},
  {x: 1500, y: 2500},
  {x: 2000, y: 3000},
  {x: 2000, y: 4000},
  {x: 0, y: 4000},
  {x: -1000, y: 3000},
  {x: -1000, y: 1000},
  {x: -500, y: 500},
  {x: 0, y: 0},
];

const CHECKPOINTS = [
  {x: 2000, y: 1500},
  {x: 1500, y: 2500},
  {x: -1000, y: 1000},
];

const PLAYER_LANES = [-72, 72];
const CAR_STYLES: CarStyle[] = ['apex', 'solaris'];
const PRACTICE_STATUS = 'Practice mode is live. Host a room or join one to race online.';
const SYNC_INTERVAL_MS = 80;

function createCarState(playerIndex: number): CarState {
  return {
    x: 0,
    y: PLAYER_LANES[playerIndex] ?? 0,
    vx: 0,
    vy: 0,
    angle: 0,
  };
}

function createHudState(): HudState {
  return {
    speedKmh: 0,
    lap: 1,
    lapTime: 0,
    bestLap: null,
  };
}

function getDistanceToTrack(p: Vec) {
  let minDistSq = Infinity;
  for (let i = 0; i < TRACK_POINTS.length - 1; i += 1) {
    const d2 = distToSegmentSquared(p, TRACK_POINTS[i], TRACK_POINTS[i + 1]);
    if (d2 < minDistSq) {
      minDistSq = d2;
    }
  }
  return Math.sqrt(minDistSq);
}

function normalizeAngle(angle: number) {
  let nextAngle = angle;
  while (nextAngle > Math.PI) {
    nextAngle -= Math.PI * 2;
  }
  while (nextAngle < -Math.PI) {
    nextAngle += Math.PI * 2;
  }
  return nextAngle;
}

function getCarStyle(playerIndex: number): CarStyle {
  return CAR_STYLES[playerIndex] ?? CAR_STYLES[0];
}

function getCarName(playerIndex: number) {
  return playerIndex === 0 ? 'Carbon GT' : 'Solaris XR';
}

function getCarAccent(style: CarStyle) {
  return style === 'apex' ? '#22d3ee' : '#fb923c';
}

async function postJson<T>(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMessage = 'Request failed.';
    try {
      const data = (await response.json()) as {error?: string};
      errorMessage = data.error ?? errorMessage;
    } catch {
      const text = await response.text();
      if (text) {
        errorMessage = text;
      }
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  ctx.fillStyle = '#166534';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  ctx.translate(cameraX, cameraY);

  ctx.fillStyle = '#14532d';
  const dotSpacing = 150;
  const startX = Math.floor(-cameraX / dotSpacing) * dotSpacing;
  const startY = Math.floor(-cameraY / dotSpacing) * dotSpacing;
  const endX = startX + canvasWidth + dotSpacing;
  const endY = startY + canvasHeight + dotSpacing;

  for (let x = startX; x < endX; x += dotSpacing) {
    for (let y = startY; y < endY; y += dotSpacing) {
      const offsetX = Math.sin(x * 12.345 + y * 67.89) * 40;
      const offsetY = Math.cos(x * 98.76 + y * 54.321) * 40;
      ctx.beginPath();
      ctx.arc(x + offsetX, y + offsetY, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(TRACK_POINTS[0].x, TRACK_POINTS[0].y);
  for (let i = 1; i < TRACK_POINTS.length; i += 1) {
    ctx.lineTo(TRACK_POINTS[i].x, TRACK_POINTS[i].y);
  }
  ctx.lineWidth = 400;
  ctx.strokeStyle = '#333';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(TRACK_POINTS[0].x, TRACK_POINTS[0].y);
  for (let i = 1; i < TRACK_POINTS.length; i += 1) {
    ctx.lineTo(TRACK_POINTS[i].x, TRACK_POINTS[i].y);
  }
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.setLineDash([40, 40]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.translate(TRACK_POINTS[0].x, TRACK_POINTS[0].y);
  const dx = TRACK_POINTS[1].x - TRACK_POINTS[0].x;
  const dy = TRACK_POINTS[1].y - TRACK_POINTS[0].y;
  ctx.rotate(Math.atan2(dy, dx));

  ctx.fillStyle = '#fff';
  ctx.fillRect(-10, -200, 20, 400);
  ctx.fillStyle = '#000';
  for (let i = -200; i < 200; i += 40) {
    ctx.fillRect(-10, i, 10, 20);
    ctx.fillRect(0, i + 20, 10, 20);
  }
  ctx.restore();
}

function drawApexCar(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.roundRect(-24, -14, 48, 28, 6);
  ctx.fill();

  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.roundRect(10, -13, 12, 4, 1);
  ctx.roundRect(10, 9, 12, 4, 1);
  ctx.roundRect(-16, -13, 12, 4, 1);
  ctx.roundRect(-16, 9, 12, 4, 1);
  ctx.fill();

  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.roundRect(-22, -11, 44, 22, 5);
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(-20, -9, 42, 18, 4);
  ctx.fill();

  ctx.fillStyle = '#06b6d4';
  ctx.fillRect(-18, -3, 38, 2);
  ctx.fillRect(-18, 1, 38, 2);

  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.roundRect(-8, -7, 18, 14, 4);
  ctx.fill();

  ctx.fillStyle = '#38bdf8';
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(4, -6);
  ctx.lineTo(11, -5);
  ctx.lineTo(11, 5);
  ctx.lineTo(4, 6);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-5, -5);
  ctx.lineTo(-9, -4);
  ctx.lineTo(-9, 4);
  ctx.lineTo(-5, 5);
  ctx.fill();

  ctx.fillRect(-3, -6.5, 6, 2);
  ctx.fillRect(-3, 4.5, 6, 2);
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.roundRect(-24, -10, 5, 20, 2);
  ctx.fill();

  ctx.fillStyle = '#334155';
  ctx.fillRect(-20, -6, 3, 2);
  ctx.fillRect(-20, 4, 3, 2);

  ctx.fillStyle = '#cffafe';
  ctx.beginPath();
  ctx.moveTo(19, -9);
  ctx.lineTo(22, -7);
  ctx.lineTo(22, -4);
  ctx.lineTo(19, -4);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(19, 9);
  ctx.lineTo(22, 7);
  ctx.lineTo(22, 4);
  ctx.lineTo(19, 4);
  ctx.fill();

  ctx.fillStyle = '#ef4444';
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = 8;
  ctx.fillRect(-22, -9, 2, 5);
  ctx.fillRect(-22, 4, 2, 5);
  ctx.shadowBlur = 0;

  const beamGradient = ctx.createLinearGradient(22, 0, 150, 0);
  beamGradient.addColorStop(0, 'rgba(207, 250, 254, 0.4)');
  beamGradient.addColorStop(1, 'rgba(207, 250, 254, 0)');
  ctx.fillStyle = beamGradient;

  ctx.beginPath();
  ctx.moveTo(22, -7);
  ctx.lineTo(150, -35);
  ctx.lineTo(150, -5);
  ctx.lineTo(22, -4);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(22, 7);
  ctx.lineTo(150, 35);
  ctx.lineTo(150, 5);
  ctx.lineTo(22, 4);
  ctx.fill();
}

function drawSolarisCar(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(0,0,0,0.46)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 28, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#111827';
  ctx.fillRect(11, -14, 11, 5);
  ctx.fillRect(11, 9, 11, 5);
  ctx.fillRect(-21, -14, 11, 5);
  ctx.fillRect(-21, 9, 11, 5);

  const bodyGradient = ctx.createLinearGradient(-24, -10, 24, 10);
  bodyGradient.addColorStop(0, '#fb923c');
  bodyGradient.addColorStop(0.6, '#f97316');
  bodyGradient.addColorStop(1, '#7c2d12');
  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.moveTo(-24, -8);
  ctx.lineTo(-8, -12);
  ctx.lineTo(16, -10);
  ctx.lineTo(24, -4);
  ctx.lineTo(24, 4);
  ctx.lineTo(16, 10);
  ctx.lineTo(-8, 12);
  ctx.lineTo(-24, 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fef3c7';
  ctx.beginPath();
  ctx.moveTo(-8, -7);
  ctx.lineTo(8, -7);
  ctx.lineTo(13, -1);
  ctx.lineTo(13, 1);
  ctx.lineTo(8, 7);
  ctx.lineTo(-8, 7);
  ctx.lineTo(-13, 1);
  ctx.lineTo(-13, -1);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#7c2d12';
  ctx.fillRect(-18, -2, 36, 4);

  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.moveTo(2, -6.5);
  ctx.lineTo(10, -4.5);
  ctx.lineTo(10, 4.5);
  ctx.lineTo(2, 6.5);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-6, -6);
  ctx.lineTo(-12, -4);
  ctx.lineTo(-12, 4);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.moveTo(20, -7);
  ctx.lineTo(24, -5);
  ctx.lineTo(24, -1);
  ctx.lineTo(20, -2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(20, 7);
  ctx.lineTo(24, 5);
  ctx.lineTo(24, 1);
  ctx.lineTo(20, 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ec4899';
  ctx.shadowColor = '#ec4899';
  ctx.shadowBlur = 12;
  ctx.fillRect(-24, -7, 3, 14);
  ctx.shadowBlur = 0;

  const flareGradient = ctx.createLinearGradient(20, 0, 120, 0);
  flareGradient.addColorStop(0, 'rgba(253, 224, 71, 0.45)');
  flareGradient.addColorStop(1, 'rgba(253, 224, 71, 0)');
  ctx.fillStyle = flareGradient;
  ctx.beginPath();
  ctx.moveTo(23, -6);
  ctx.lineTo(120, -24);
  ctx.lineTo(120, -2);
  ctx.lineTo(23, -1);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(23, 6);
  ctx.lineTo(120, 24);
  ctx.lineTo(120, 2);
  ctx.lineTo(23, 1);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#451a03';
  ctx.fillRect(-15, -10, 4, 20);
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  state: {x: number; y: number; angle: number},
  style: CarStyle,
  label: string,
  opacity = 1,
) {
  ctx.save();
  ctx.translate(state.x, state.y);
  ctx.rotate(state.angle);
  ctx.globalAlpha = opacity;

  if (style === 'solaris') {
    drawSolarisCar(ctx);
  } else {
    drawApexCar(ctx);
  }

  ctx.restore();

  ctx.save();
  ctx.translate(state.x, state.y - 46);
  ctx.globalAlpha = opacity;
  ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
  ctx.beginPath();
  ctx.roundRect(-52, -12, 104, 20, 10);
  ctx.fill();
  ctx.fillStyle = getCarAccent(style);
  ctx.fillText(label, 0, 2.5);
  ctx.restore();
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${hundredths
    .toString()
    .padStart(2, '0')}`;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keys = useRef<Record<string, boolean>>({});
  const car = useRef<CarState>(createCarState(0));
  const skidMarks = useRef<SkidMark[]>([]);
  const hudRef = useRef<HudState>(createHudState());
  const remoteCars = useRef<Map<string, RemoteRenderState>>(new Map());
  const playerIndexRef = useRef(0);
  const gameState = useRef({
    nextCheckpoint: 0,
    lapStartTime: performance.now(),
  });
  const session = useRef<MultiplayerSession>({
    roomCode: '',
    playerId: '',
    playerIndex: 0,
    eventSource: null,
    lastSyncAt: 0,
    syncInFlight: false,
  });

  const [hud, setHud] = useState<HudState>(createHudState());
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [playerIndex, setPlayerIndex] = useState(0);
  const [players, setPlayers] = useState<PlayerSnapshot[]>([]);
  const [connectionState, setConnectionState] = useState<
    'offline' | 'connecting' | 'connected' | 'error'
  >('offline');
  const [networkStatus, setNetworkStatus] = useState(PRACTICE_STATUS);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const applyPlayerIndex = (nextPlayerIndex: number) => {
    playerIndexRef.current = nextPlayerIndex;
    setPlayerIndex(nextPlayerIndex);
  };

  const resetRace = (nextPlayerIndex: number) => {
    car.current = createCarState(nextPlayerIndex);
    skidMarks.current = [];
    gameState.current = {
      nextCheckpoint: 0,
      lapStartTime: performance.now(),
    };

    const nextHud = createHudState();
    hudRef.current = nextHud;
    setHud(nextHud);
  };

  const closeEventSource = () => {
    if (session.current.eventSource) {
      session.current.eventSource.close();
      session.current.eventSource = null;
    }
  };

  const applyRoomPayload = (payload: RoomSyncPayload, localPlayerId: string) => {
    const nextRemoteCars = new Map<string, RemoteRenderState>(remoteCars.current);
    const seenRemotePlayers = new Set<string>();
    const sortedPlayers = [...payload.players].sort(
      (left, right) => left.playerIndex - right.playerIndex,
    );

    setPlayers(sortedPlayers);
    setRoomCode(payload.roomCode);
    setConnectionState('connected');
    setNetworkError(null);

    const remotePlayerCount = sortedPlayers.filter(
      (player) => player.playerId !== localPlayerId,
    ).length;

    setNetworkStatus(
      remotePlayerCount > 0
        ? 'Two cars are live on the circuit.'
        : `Room ${payload.roomCode} is ready. Waiting for another racer.`,
    );

    for (const player of sortedPlayers) {
      if (player.playerId === localPlayerId) {
        continue;
      }

      seenRemotePlayers.add(player.playerId);
      const existing = nextRemoteCars.get(player.playerId);
      if (existing) {
        nextRemoteCars.set(player.playerId, {
          ...existing,
          ...player,
        });
      } else {
        nextRemoteCars.set(player.playerId, {
          ...player,
          renderX: player.x,
          renderY: player.y,
          renderAngle: player.angle,
        });
      }
    }

    for (const playerId of nextRemoteCars.keys()) {
      if (!seenRemotePlayers.has(playerId)) {
        nextRemoteCars.delete(playerId);
      }
    }

    remoteCars.current = nextRemoteCars;
  };

  const resetToPracticeMode = () => {
    closeEventSource();
    remoteCars.current.clear();
    setPlayers([]);
    setRoomCode('');
    applyPlayerIndex(0);
    session.current = {
      roomCode: '',
      playerId: '',
      playerIndex: 0,
      eventSource: null,
      lastSyncAt: 0,
      syncInFlight: false,
    };
    setConnectionState('offline');
    setNetworkStatus(PRACTICE_STATUS);
    setNetworkError(null);
    resetRace(0);
  };

  const leaveRoom = async (notifyServer: boolean) => {
    const activeSession = {...session.current};
    resetToPracticeMode();

    if (!notifyServer || !activeSession.roomCode || !activeSession.playerId) {
      return;
    }

    try {
      await postJson(`/api/rooms/${activeSession.roomCode}/leave`, {
        playerId: activeSession.playerId,
      });
    } catch {
      // Room cleanup is best-effort.
    }
  };

  const beginSession = (nextSession: SessionResponse) => {
    closeEventSource();

    session.current = {
      roomCode: nextSession.roomCode,
      playerId: nextSession.playerId,
      playerIndex: nextSession.playerIndex,
      eventSource: null,
      lastSyncAt: 0,
      syncInFlight: false,
    };

    applyPlayerIndex(nextSession.playerIndex);
    setRoomCode(nextSession.roomCode);
    setJoinCode(nextSession.roomCode);
    setConnectionState('connecting');
    setNetworkError(null);
    resetRace(nextSession.playerIndex);
    applyRoomPayload(
      {
        roomCode: nextSession.roomCode,
        players: nextSession.players,
      },
      nextSession.playerId,
    );

    const eventSource = new EventSource(
      `/api/rooms/${nextSession.roomCode}/events?playerId=${encodeURIComponent(nextSession.playerId)}`,
    );

    session.current.eventSource = eventSource;

    eventSource.onopen = () => {
      setConnectionState('connected');
      setNetworkError(null);
    };

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as RoomSyncPayload;
      applyRoomPayload(payload, nextSession.playerId);
    };

    eventSource.onerror = () => {
      setConnectionState((currentState) =>
        currentState === 'connected' ? 'connecting' : currentState,
      );
      setNetworkStatus(`Trying to reconnect to room ${nextSession.roomCode}...`);
    };
  };

  const handleCreateRoom = async () => {
    if (session.current.roomCode) {
      await leaveRoom(true);
    }

    setConnectionState('connecting');
    setNetworkStatus('Creating a multiplayer room...');
    setNetworkError(null);

    try {
      const response = await postJson<SessionResponse>('/api/rooms');
      beginSession(response);
    } catch (error) {
      setConnectionState('error');
      setNetworkStatus('Creating the room failed.');
      setNetworkError(error instanceof Error ? error.message : 'Unknown network error.');
    }
  };

  const handleJoinRoom = async () => {
    const normalizedRoomCode = joinCode.trim().toUpperCase();
    if (!normalizedRoomCode) {
      setConnectionState('error');
      setNetworkError('Enter a room code first.');
      return;
    }

    if (session.current.roomCode) {
      await leaveRoom(true);
    }

    setConnectionState('connecting');
    setNetworkStatus(`Joining room ${normalizedRoomCode}...`);
    setNetworkError(null);

    try {
      const response = await postJson<SessionResponse>(
        `/api/rooms/${normalizedRoomCode}/join`,
      );
      beginSession(response);
    } catch (error) {
      setConnectionState('error');
      setNetworkStatus(`Joining room ${normalizedRoomCode} failed.`);
      setNetworkError(error instanceof Error ? error.message : 'Unknown network error.');
    }
  };

  useEffect(() => {
    return () => {
      const activeSession = session.current;
      closeEventSource();
      if (!activeSession.roomCode || !activeSession.playerId) {
        return;
      }

      void fetch(`/api/rooms/${activeSession.roomCode}/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId: activeSession.playerId,
        }),
        keepalive: true,
      }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const shouldIgnoreKeyEvent = (target: EventTarget | null) => {
      return (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyEvent(event.target)) {
        return;
      }
      keys.current[event.key.toLowerCase()] = true;
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyEvent(event.target)) {
        return;
      }
      keys.current[event.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const canvas = canvasRef.current;
    if (!canvas) {
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      };
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      };
    }

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', resize);
    resize();

    let animationId = 0;
    let cameraX = canvas.width / 2;
    let cameraY = canvas.height / 2;

    const loop = (time: number) => {
      const localCar = car.current;
      const raceState = gameState.current;
      const previousX = localCar.x;

      const isAccelerating = keys.current.arrowup || keys.current.w;
      const isBraking = keys.current.arrowdown || keys.current.s;
      const isTurningLeft = keys.current.arrowleft || keys.current.a;
      const isTurningRight = keys.current.arrowright || keys.current.d;

      const forwardX = Math.cos(localCar.angle);
      const forwardY = Math.sin(localCar.angle);
      const rightX = Math.cos(localCar.angle + Math.PI / 2);
      const rightY = Math.sin(localCar.angle + Math.PI / 2);

      const speed = localCar.vx * forwardX + localCar.vy * forwardY;
      const lateralSpeed = localCar.vx * rightX + localCar.vy * rightY;

      const distanceToTrack = getDistanceToTrack(localCar);
      const isOnTrack = distanceToTrack < 200;

      const engineForce = isOnTrack ? 0.6 : 0.3;
      const brakingForce = isOnTrack ? 0.8 : 0.4;
      const turnSpeed = 0.05;
      const drag = isOnTrack ? 0.97 : 0.9;
      const grip = isOnTrack ? 0.15 : 0.05;

      if (isAccelerating) {
        localCar.vx += forwardX * engineForce;
        localCar.vy += forwardY * engineForce;
      }

      if (isBraking) {
        localCar.vx -= forwardX * brakingForce;
        localCar.vy -= forwardY * brakingForce;
      }

      if (Math.abs(speed) > 0.5) {
        const turnDirection = speed > 0 ? 1 : -1;
        if (isTurningLeft) {
          localCar.angle -= turnSpeed * turnDirection;
        }
        if (isTurningRight) {
          localCar.angle += turnSpeed * turnDirection;
        }
      }

      localCar.vx -= rightX * lateralSpeed * grip;
      localCar.vy -= rightY * lateralSpeed * grip;
      localCar.vx *= drag;
      localCar.vy *= drag;
      localCar.x += localCar.vx;
      localCar.y += localCar.vy;

      if (Math.abs(lateralSpeed) > 3 && isOnTrack) {
        skidMarks.current.push({
          x: localCar.x + rightX * -11 - forwardX * 16,
          y: localCar.y + rightY * -11 - forwardY * 16,
          life: 1,
        });
        skidMarks.current.push({
          x: localCar.x + rightX * 11 - forwardX * 16,
          y: localCar.y + rightY * 11 - forwardY * 16,
          life: 1,
        });
      }

      for (let i = skidMarks.current.length - 1; i >= 0; i -= 1) {
        skidMarks.current[i].life -= 0.02;
        if (skidMarks.current[i].life <= 0) {
          skidMarks.current.splice(i, 1);
        }
      }

      if (raceState.nextCheckpoint < CHECKPOINTS.length) {
        const checkpoint = CHECKPOINTS[raceState.nextCheckpoint];
        if (dist2(localCar, checkpoint) < 400 * 400) {
          raceState.nextCheckpoint += 1;
        }
      } else if (previousX < 0 && localCar.x >= 0 && Math.abs(localCar.y) < 200) {
        const currentLapTime = time - raceState.lapStartTime;
        hudRef.current.bestLap =
          hudRef.current.bestLap === null
            ? currentLapTime
            : Math.min(hudRef.current.bestLap, currentLapTime);
        hudRef.current.lap += 1;
        raceState.nextCheckpoint = 0;
        raceState.lapStartTime = time;
      }

      hudRef.current.speedKmh = Math.abs(Math.round(speed * 5));
      hudRef.current.lapTime = time - raceState.lapStartTime;
      setHud({...hudRef.current});

      const activeSession = session.current;
      if (
        activeSession.roomCode &&
        activeSession.playerId &&
        !activeSession.syncInFlight &&
        time - activeSession.lastSyncAt >= SYNC_INTERVAL_MS
      ) {
        activeSession.lastSyncAt = time;
        activeSession.syncInFlight = true;

        const snapshot: PlayerSnapshot = {
          playerId: activeSession.playerId,
          playerIndex: playerIndexRef.current,
          style: getCarStyle(playerIndexRef.current),
          x: localCar.x,
          y: localCar.y,
          vx: localCar.vx,
          vy: localCar.vy,
          angle: localCar.angle,
          speedKmh: hudRef.current.speedKmh,
          lap: hudRef.current.lap,
          lapTime: hudRef.current.lapTime,
          bestLap: hudRef.current.bestLap,
          connected: true,
          updatedAt: Date.now(),
        };

        void postJson(`/api/rooms/${activeSession.roomCode}/sync`, {
          playerId: activeSession.playerId,
          snapshot,
        })
          .catch(() => {
            setConnectionState((currentState) =>
              currentState === 'offline' ? currentState : 'error',
            );
            setNetworkError('Live sync is having trouble reaching the room server.');
          })
          .finally(() => {
            activeSession.syncInFlight = false;
          });
      }

      const targetCameraX = canvas.width / 2 - (localCar.x + localCar.vx * 15);
      const targetCameraY = canvas.height / 2 - (localCar.y + localCar.vy * 15);
      cameraX += (targetCameraX - cameraX) * 0.1;
      cameraY += (targetCameraY - cameraY) * 0.1;

      drawTrack(ctx, cameraX, cameraY, canvas.width, canvas.height);

      skidMarks.current.forEach((mark) => {
        ctx.fillStyle = `rgba(0, 0, 0, ${mark.life * 0.4})`;
        ctx.beginPath();
        ctx.arc(mark.x + cameraX, mark.y + cameraY, 5, 0, Math.PI * 2);
        ctx.fill();
      });

      for (const remoteCar of remoteCars.current.values()) {
        remoteCar.renderX += (remoteCar.x - remoteCar.renderX) * 0.2;
        remoteCar.renderY += (remoteCar.y - remoteCar.renderY) * 0.2;
        remoteCar.renderAngle +=
          normalizeAngle(remoteCar.angle - remoteCar.renderAngle) * 0.2;

        drawCar(
          ctx,
          {
            x: remoteCar.renderX + cameraX,
            y: remoteCar.renderY + cameraY,
            angle: remoteCar.renderAngle,
          },
          remoteCar.style,
          `P${remoteCar.playerIndex + 1} ${getCarName(remoteCar.playerIndex)}`,
          remoteCar.connected ? 1 : 0.55,
        );
      }

      drawCar(
        ctx,
        {
          x: localCar.x + cameraX,
          y: localCar.y + cameraY,
          angle: localCar.angle,
        },
        getCarStyle(playerIndexRef.current),
        `You · ${getCarName(playerIndexRef.current)}`,
      );

      ctx.restore();

      animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-emerald-950 text-white">
      <canvas ref={canvasRef} className="block h-full w-full" />

      <div className="pointer-events-none absolute left-6 top-6 max-w-sm rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl backdrop-blur-md">
        <div className="mb-4">
          <h1 className="bg-gradient-to-r from-rose-400 via-orange-300 to-amber-200 bg-clip-text text-3xl font-black uppercase italic tracking-[0.25em] text-transparent">
            Apex Racer
          </h1>
          <p className="mt-2 text-sm font-medium text-slate-300">
            WASD or arrows to drive. Open a second browser window or device to race the
            networked car.
          </p>
        </div>

        <div className="space-y-2 font-mono">
          <div className="flex items-center justify-between gap-6">
            <span className="text-xs uppercase tracking-[0.25em] text-slate-400">Lap</span>
            <span className="text-xl font-bold">{hud.lap}</span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="text-xs uppercase tracking-[0.25em] text-slate-400">Time</span>
            <span className="text-xl font-bold text-amber-300">{formatTime(hud.lapTime)}</span>
          </div>
          {hud.bestLap !== null && (
            <div className="flex items-center justify-between gap-6">
              <span className="text-xs uppercase tracking-[0.25em] text-slate-400">Best</span>
              <span className="text-lg font-bold text-emerald-400">
                {formatTime(hud.bestLap)}
              </span>
            </div>
          )}
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs uppercase tracking-[0.25em] text-slate-400">Car</span>
            <span
              className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.2em]"
              style={{
                backgroundColor: `${getCarAccent(getCarStyle(playerIndex))}22`,
                color: getCarAccent(getCarStyle(playerIndex)),
              }}
            >
              {getCarName(playerIndex)}
            </span>
          </div>
          {roomCode && (
            <div className="mt-3 flex items-center justify-between gap-4 font-mono">
              <span className="text-xs uppercase tracking-[0.25em] text-slate-400">Room</span>
              <span className="text-lg font-bold tracking-[0.3em] text-cyan-300">{roomCode}</span>
            </div>
          )}
        </div>
      </div>

      <div className="absolute right-6 top-6 w-[22rem] rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl backdrop-blur-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-400">
              Network Multiplayer
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Two-Car Room Sync</h2>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] ${
              connectionState === 'connected'
                ? 'bg-emerald-500/15 text-emerald-300'
                : connectionState === 'connecting'
                  ? 'bg-amber-500/15 text-amber-300'
                  : connectionState === 'error'
                    ? 'bg-rose-500/15 text-rose-300'
                    : 'bg-slate-500/15 text-slate-300'
            }`}
          >
            {connectionState}
          </span>
        </div>

        <p className="mt-3 text-sm leading-6 text-slate-300">{networkStatus}</p>
        {networkError && <p className="mt-2 text-sm text-rose-300">{networkError}</p>}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleCreateRoom}
            className="rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-3 text-sm font-bold uppercase tracking-[0.2em] text-slate-950 transition hover:brightness-110"
          >
            Host Room
          </button>
          <button
            type="button"
            onClick={() => void leaveRoom(true)}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-white/10"
          >
            Leave Room
          </button>
        </div>

        <div className="mt-4 flex gap-3">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase().slice(0, 6))}
            placeholder="ROOM CODE"
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm font-semibold uppercase tracking-[0.35em] text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/60"
          />
          <button
            type="button"
            onClick={handleJoinRoom}
            className="rounded-2xl bg-gradient-to-r from-orange-400 to-rose-500 px-4 py-3 text-sm font-bold uppercase tracking-[0.2em] text-white transition hover:brightness-110"
          >
            Join
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {players.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
              No active room yet. Host one to generate a code.
            </div>
          )}

          {players.map((player) => (
            <div
              key={player.playerId}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-bold uppercase tracking-[0.2em] text-white">
                    Player {player.playerIndex + 1}
                  </div>
                  <div
                    className="mt-1 text-xs font-semibold uppercase tracking-[0.25em]"
                    style={{color: getCarAccent(player.style)}}
                  >
                    {getCarName(player.playerIndex)}
                  </div>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] ${
                    player.connected
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-500/15 text-slate-300'
                  }`}
                >
                  {player.connected ? 'On Track' : 'Idle'}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-xs text-slate-300">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Speed
                  </div>
                  <div className="mt-1 text-sm font-bold text-white">{player.speedKmh}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Lap
                  </div>
                  <div className="mt-1 text-sm font-bold text-white">{player.lap}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Best
                  </div>
                  <div className="mt-1 text-sm font-bold text-white">
                    {player.bestLap === null ? '--' : formatTime(player.bestLap)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-8 right-8 rounded-[2rem] border border-white/10 bg-slate-950/70 p-6 text-right shadow-2xl backdrop-blur-md">
        <div className="text-5xl font-black italic tracking-tighter">{hud.speedKmh}</div>
        <div className="mt-1 text-sm font-bold uppercase tracking-[0.35em] text-rose-300">
          km/h
        </div>
      </div>
    </div>
  );
}
