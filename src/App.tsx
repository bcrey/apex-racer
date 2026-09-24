import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMissingSupabaseRealtimeEnvVars,
  getSupabaseClient,
  hasSupabaseRealtimeConfig,
} from './lib/supabase';
import {
  emptyLeaderboardData,
  LEADERBOARD_LIMIT,
  normalizeInitials,
  type LeaderboardData,
  type LeaderboardEntry,
} from '../lib/leaderboardShared';
import {
  getFirstOpenSlot,
  getGridPlacement,
  getGridSlotPosition,
  HALF_TRACK_WIDTH,
  START_FINISH_LINE_WIDTH,
  START_FINISH_X,
  START_FINISH_Y,
  TRACK_WIDTH,
  traceTrack,
  trackPoints,
} from './track';
import SpeedGauge from './SpeedGauge';
import {
  drawCarV2,
  drawGrassV2,
  drawLightLayerV2,
  drawMinimap,
  drawSkidMarksV2,
  drawTrackV2,
  drawGrass,
  drawSmoke,
  getViewportZoomScale,
  HEADLIGHT_REACH,
  prepareHeadlights,
  MINIMAP_ASPECT,
  spawnGrass,
  spawnSmoke,
  updateGrass,
  updateSmoke,
  V2_TOP_SPEED,
  V2_ZOOM,
  V2_ZOOM_AT_SPEED,
  type GrassParticle,
  type GraphicsMode,
  type SkidMark,
  type SmokeParticle,
} from './graphicsV2';

// --- Math & Physics Helpers ---
function sqr(x: number) { return x * x; }
function dist2(v: {x: number, y: number}, w: {x: number, y: number}) { return sqr(v.x - w.x) + sqr(v.y - w.y); }
function distToSegmentSquared(p: {x: number, y: number}, v: {x: number, y: number}, w: {x: number, y: number}) {
  const l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

// Anti-cheat checkpoints
const checkpoints = [
  {x: 2000, y: 1500},
  {x: 1500, y: 2500},
  {x: -1000, y: 1000}
];

const DEFAULT_START = getGridSlotPosition(0);

type RemotePlayer = {
  id: string;
  initials: string;
  color: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  lights?: boolean;
};

type PresencePlayer = RemotePlayer & {
  slotIndex: number;
};

type CarUpdate = Pick<RemotePlayer, 'id' | 'x' | 'y' | 'angle' | 'vx' | 'vy' | 'lights'>;

type MultiplayerConnection = {
  close: () => void;
  sendUpdate: (update: CarUpdate) => void;
  broadcastLeaderboard: () => void;
};

type ConfettiParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  life: number;
  size: number;
  color: string;
  shape: 'rect' | 'circle';
};

type ExplosionParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
};

const MOBILE_HUD_BREAKPOINT = 768;
const PODIUM = [
  { emoji: '🥇', label: 'gold' },
  { emoji: '🥈', label: 'silver' },
  { emoji: '🥉', label: 'bronze' },
] as const;
const CONFETTI_COLORS = ['#f43f5e', '#f59e0b', '#fde047', '#22c55e', '#38bdf8', '#a78bfa'];
const PODIUM_CONFETTI_COLORS = [
  ['#facc15', '#fde047', '#fef3c7', '#f59e0b'],
  ['#e2e8f0', '#cbd5e1', '#94a3b8', '#f8fafc'],
  ['#f97316', '#fdba74', '#fed7aa', '#7c2d12'],
] as const;
const EXPLOSION_COLORS = ['#ffffff', '#fde047', '#fb7185', '#f97316', '#ef4444'] as const;
const EASTER_EGG_INITIALS = 'SLY';
const GRAPHICS_MODE_STORAGE_KEY = 'apex-racer:graphics';
const HUD_UPDATE_INTERVAL_MS = 33;

function loadGraphicsMode(): GraphicsMode {
  try {
    return window.localStorage.getItem(GRAPHICS_MODE_STORAGE_KEY) === 'classic' ? 'classic' : 'v2';
  } catch {
    return 'v2';
  }
}

function getDistanceToTrack(p: {x: number, y: number}) {
  let minDistSq = Infinity;
  for (let i = 0; i < trackPoints.length - 1; i++) {
    const d2 = distToSegmentSquared(p, trackPoints[i], trackPoints[i+1]);
    if (d2 < minDistSq) minDistSq = d2;
  }
  return Math.sqrt(minDistSq);
}

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string, isLocal: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.roundRect(-24, -14, 48, 28, 6);
  ctx.fill();

  // Tires
  ctx.fillStyle = '#020617'; // Very dark slate
  ctx.beginPath();
  ctx.roundRect(10, -13, 12, 4, 1); // Front Left
  ctx.roundRect(10, 9, 12, 4, 1);  // Front Right
  ctx.roundRect(-16, -13, 12, 4, 1); // Rear Left
  ctx.roundRect(-16, 9, 12, 4, 1);  // Rear Right
  ctx.fill();

  // Main Body Base (Widebody)
  ctx.fillStyle = '#1e293b'; // Slate 800
  ctx.beginPath();
  ctx.roundRect(-22, -11, 44, 22, 5);
  ctx.fill();

  // Center Body
  ctx.fillStyle = '#0f172a'; // Slate 900
  ctx.beginPath();
  ctx.roundRect(-20, -9, 42, 18, 4);
  ctx.fill();

  // Racing Stripes
  ctx.fillStyle = color;
  ctx.fillRect(-18, -3, 38, 2);
  ctx.fillRect(-18, 1, 38, 2);

  // Cockpit Roof
  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.roundRect(-8, -7, 18, 14, 4);
  ctx.fill();

  // Windows
  ctx.fillStyle = '#38bdf8'; // Sky 400
  ctx.globalAlpha = 0.7;
  // Windshield
  ctx.beginPath();
  ctx.moveTo(4, -6);
  ctx.lineTo(11, -5);
  ctx.lineTo(11, 5);
  ctx.lineTo(4, 6);
  ctx.fill();
  // Rear Window
  ctx.beginPath();
  ctx.moveTo(-5, -5);
  ctx.lineTo(-9, -4);
  ctx.lineTo(-9, 4);
  ctx.lineTo(-5, 5);
  ctx.fill();
  // Side Windows
  ctx.fillRect(-3, -6.5, 6, 2);
  ctx.fillRect(-3, 4.5, 6, 2);
  ctx.globalAlpha = 1.0;

  // Spoiler
  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.roundRect(-24, -10, 5, 20, 2);
  ctx.fill();
  // Spoiler Mounts
  ctx.fillStyle = '#334155';
  ctx.fillRect(-20, -6, 3, 2);
  ctx.fillRect(-20, 4, 3, 2);

  // Headlights
  ctx.fillStyle = '#cffafe'; // Cyan 100
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

  // Taillights
  ctx.fillStyle = '#ef4444'; // Red 500
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = 8;
  ctx.fillRect(-22, -9, 2, 5);
  ctx.fillRect(-22, 4, 2, 5);
  ctx.shadowBlur = 0;

  if (isLocal) {
    // Headlight Beams
    const beamGrad = ctx.createLinearGradient(22, 0, 150, 0);
    beamGrad.addColorStop(0, 'rgba(207, 250, 254, 0.4)'); // Cyan 100 with opacity
    beamGrad.addColorStop(1, 'rgba(207, 250, 254, 0)');
    ctx.fillStyle = beamGrad;
    
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

  ctx.restore();
}

function drawDriverTag(ctx: CanvasRenderingContext2D, x: number, y: number, initials: string, color: string) {
  ctx.save();
  ctx.translate(x, y - 44);
  ctx.font = '700 14px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const textWidth = ctx.measureText(initials).width;
  const tagWidth = Math.max(42, textWidth + 20);
  const tagHeight = 24;
  const pointerHeight = 8;
  const tagTop = -tagHeight - pointerHeight;

  ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-tagWidth / 2, tagTop, tagWidth, tagHeight, 12);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-7, -pointerHeight);
  ctx.lineTo(0, 0);
  ctx.lineTo(7, -pointerHeight);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.fillText(initials, 0, tagTop + tagHeight / 2);
  ctx.restore();
}

function getLeaderboardPlacement(
  timeMs: number,
  entries: LeaderboardEntry[],
  placementLimit = LEADERBOARD_LIMIT,
) {
  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    return null;
  }

  let placement = 0;
  while (placement < entries.length && timeMs > entries[placement].timeMs) {
    placement++;
  }

  if (placement < placementLimit) {
    return placement;
  }

  return entries.length < placementLimit ? entries.length : null;
}

function getBestLeaderboardPlacement(
  timeMs: number,
  leaderboard: LeaderboardData,
  placementLimit = LEADERBOARD_LIMIT,
) {
  const placements = [
    getLeaderboardPlacement(timeMs, leaderboard.allTime, placementLimit),
    getLeaderboardPlacement(timeMs, leaderboard.today, placementLimit),
  ].filter((placement): placement is number => placement !== null);

  if (placements.length === 0) {
    return null;
  }

  return Math.min(...placements);
}

function formatTime(ms: number | null | undefined) {
  if (ms == null) {
    return '--:--.--';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
}

function createConfettiBurst(
  side: 'left' | 'right',
  viewportWidth: number,
  viewportHeight: number,
  colors: readonly string[] = CONFETTI_COLORS,
): ConfettiParticle[] {
  const originX = side === 'left' ? -24 : viewportWidth + 24;
  const direction = side === 'left' ? 1 : -1;
  const originY = viewportHeight * (0.62 + Math.random() * 0.14);

  return Array.from({ length: 28 }, (_, index) => {
    const size = 6 + Math.random() * 8;

    return {
      x: originX + (side === 'left' ? -Math.random() * 18 : Math.random() * 18),
      y: originY + (Math.random() - 0.5) * 72,
      vx: direction * (7 + Math.random() * 7),
      vy: -12 - Math.random() * 10,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.4,
      life: 72 + Math.random() * 36,
      size,
      color: colors[(index + Math.floor(Math.random() * colors.length)) % colors.length],
      shape: Math.random() > 0.25 ? 'rect' : 'circle',
    };
  });
}

function createExplosionBurst(x: number, y: number, accentColor: string): ExplosionParticle[] {
  return Array.from({ length: 34 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 34 + Math.random() * 0.35;
    const speed = 4 + Math.random() * 10;
    const colors = [...EXPLOSION_COLORS, accentColor];

    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 26 + Math.random() * 18,
      size: 7 + Math.random() * 11,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });
}

function flattenPresencePlayers(presenceState: Record<string, PresencePlayer[]>) {
  return Object.values(presenceState).flat();
}

function getClientTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

async function requestLeaderboard(errorMessage: string, init?: RequestInit, timeZone?: string) {
  const query = timeZone ? `?timeZone=${encodeURIComponent(timeZone)}` : '';
  const response = await fetch(`/api/leaderboard${query}`, init);
  if (!response.ok) {
    throw new Error(errorMessage);
  }

  const data = await response.json() as { leaderboard?: LeaderboardData };
  return data.leaderboard ?? emptyLeaderboardData();
}

const fetchLeaderboard = (timeZone: string) => requestLeaderboard('Unable to load leaderboard', undefined, timeZone);

const submitLapTime = (initials: string, timeMs: number, timeZone: string) =>
  requestLeaderboard('Unable to save lap time', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initials, timeMs, timeZone }),
  });

const resetLeaderboard = (timeZone: string) =>
  requestLeaderboard('Unable to reset leaderboard', { method: 'DELETE' }, timeZone);

/** Applies a car update from the network onto the stored remote player. */
function applyCarUpdate(player: RemotePlayer, update: CarUpdate) {
  player.x = update.x;
  player.y = update.y;
  player.angle = update.angle;
  player.vx = update.vx;
  player.vy = update.vy;
  player.lights = update.lights;
}

function remoteLightStrength(player: RemotePlayer) {
  return player.lights === false ? 0 : 0.5;
}

function isMobileViewport() {
  return window.matchMedia(`(max-width: ${MOBILE_HUD_BREAKPOINT - 1}px)`).matches;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [speedMph, setSpeedMph] = useState(0);
  const [lap, setLap] = useState(1);
  const [lapTime, setLapTime] = useState(0);
  const [lastLap, setLastLap] = useState<number | null>(null);
  const [bestLap, setBestLap] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData>(() => emptyLeaderboardData());
  const [leaderboardStatus, setLeaderboardStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [playerInitials, setPlayerInitials] = useState('');
  const [initialsInput, setInitialsInput] = useState('');
  const [isMobileHud, setIsMobileHud] = useState(isMobileViewport);
  const [isHudOpen, setIsHudOpen] = useState(() => !isMobileViewport());
  const [lapReadyToFinish, setLapReadyToFinish] = useState(false);
  const [lapCelebrationMessage, setLapCelebrationMessage] = useState<string | null>(null);
  const [isResettingLeaderboard, setIsResettingLeaderboard] = useState(false);
  const clientTimeZone = useRef(getClientTimeZone());
  const [graphicsMode, setGraphicsMode] = useState<GraphicsMode>(loadGraphicsMode);
  const graphicsModeRef = useRef(graphicsMode);
  const resizeCanvasRef = useRef<(() => void) | null>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const [headlightsOn, setHeadlightsOn] = useState(true);
  const headlightsOnRef = useRef(headlightsOn);

  // --- Multiplayer State ---
  const multiplayerRef = useRef<MultiplayerConnection | null>(null);
  const myIdRef = useRef<string | null>(null);
  const myColorRef = useRef<string>('#06b6d4');
  const remotePlayers = useRef<Map<string, RemotePlayer>>(new Map());
  const lastSendTime = useRef<number>(0);
  const leaderboardRef = useRef<LeaderboardData>(emptyLeaderboardData());
  const confettiParticles = useRef<ConfettiParticle[]>([]);
  const explosionParticles = useRef<ExplosionParticle[]>([]);
  const isDestroyedRef = useRef(false);

  const keys = useRef<{ [key: string]: boolean }>({});
  const car = useRef({
    x: DEFAULT_START.x, y: DEFAULT_START.y,
    vx: 0, vy: 0,
    angle: 0,
  });
  const skidMarks = useRef<SkidMark[]>([]);
  const skidStreak = useRef<{ id: number; surface: 'road' | 'grass' | null }>({ id: 0, surface: null });
  const smokeParticles = useRef<SmokeParticle[]>([]);
  const grassParticles = useRef<GrassParticle[]>([]);
  const gameState = useRef({
    nextCheckpoint: 0,
    lapStartTime: performance.now(),
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_HUD_BREAKPOINT - 1}px)`);

    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileHud(event.matches);
      setIsHudOpen(!event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  useEffect(() => {
    if (!lapCelebrationMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLapCelebrationMessage(null);
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [lapCelebrationMessage]);

  useEffect(() => {
    leaderboardRef.current = leaderboard;
  }, [leaderboard]);

  useEffect(() => {
    headlightsOnRef.current = headlightsOn;
  }, [headlightsOn]);

  useEffect(() => {
    graphicsModeRef.current = graphicsMode;
    resizeCanvasRef.current?.();
    try {
      window.localStorage.setItem(GRAPHICS_MODE_STORAGE_KEY, graphicsMode);
    } catch {
      // Private mode or blocked storage: the choice just won't persist
    }
    if (graphicsMode === 'v2') {
      // Build the headlight sprite now, not in the middle of the first lit frame
      const timeoutId = window.setTimeout(prepareHeadlights, 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [graphicsMode]);

  // Runs a leaderboard request and shows its result (or the error state)
  const updateLeaderboard = useCallback(async (request: () => Promise<LeaderboardData>) => {
    try {
      setLeaderboard(await request());
      setLeaderboardStatus('ready');
      return true;
    } catch (error) {
      console.error(error);
      setLeaderboardStatus('error');
      return false;
    }
  }, []);

  const loadLeaderboard = useCallback(() => {
    setLeaderboardStatus('loading');
    return updateLeaderboard(() => fetchLeaderboard(clientTimeZone.current));
  }, [updateLeaderboard]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    if (!playerInitials) {
      return;
    }

    let cancelled = false;

    const saveLapTime = async (timeMs: number) => {
      const saved = await updateLeaderboard(() => submitLapTime(playerInitials, timeMs, clientTimeZone.current));
      if (saved && !cancelled) {
        multiplayerRef.current?.broadcastLeaderboard();
      }
    };

    car.current.x = DEFAULT_START.x;
    car.current.y = DEFAULT_START.y;
    car.current.vx = 0;
    car.current.vy = 0;
    car.current.angle = 0;
    myColorRef.current = '#06b6d4';
    myIdRef.current = 'local';
    remotePlayers.current.clear();
    confettiParticles.current = [];
    explosionParticles.current = [];
    isDestroyedRef.current = false;
    setLastLap(null);
    setLapReadyToFinish(false);
    setLapCelebrationMessage(null);
    const isVercelHost = window.location.hostname.endsWith('.vercel.app');
    multiplayerRef.current = null;

    const syncRemotePlayersFromPresence = (players: PresencePlayer[]) => {
      const nextPlayers = new Map<string, RemotePlayer>();

      players.forEach((player) => {
        if (player.id === myIdRef.current) {
          return;
        }

        const previousPlayer = remotePlayers.current.get(player.id);
        nextPlayers.set(player.id, {
          id: player.id,
          initials: player.initials,
          color: player.color,
          x: previousPlayer?.x ?? player.x,
          y: previousPlayer?.y ?? player.y,
          angle: previousPlayer?.angle ?? player.angle,
          vx: previousPlayer?.vx ?? player.vx,
          vy: previousPlayer?.vy ?? player.vy,
          lights: previousPlayer?.lights,
        });
      });

      remotePlayers.current = nextPlayers;
    };

    const setupLocalWebSocketConnection = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}?initials=${encodeURIComponent(playerInitials)}`;
      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'init') {
            myIdRef.current = msg.id;
            myColorRef.current = msg.color;
            car.current.x = msg.x;
            car.current.y = msg.y;
            remotePlayers.current.clear();
            msg.players.forEach((p: RemotePlayer) => {
              if (p.id !== msg.id) remotePlayers.current.set(p.id, p);
            });
          } else if (msg.type === 'join') {
            remotePlayers.current.set(msg.player.id, msg.player);
          } else if (msg.type === 'update') {
            const p = remotePlayers.current.get(msg.id);
            if (p) {
              applyCarUpdate(p, msg);
            }
          } else if (msg.type === 'leaderboard') {
            void loadLeaderboard();
          } else if (msg.type === 'leave') {
            remotePlayers.current.delete(msg.id);
          }
        } catch (e) {
          console.error(e);
        }
      };

      return {
        close: () => {
          ws.close();
        },
        sendUpdate: (update: CarUpdate) => {
          if (ws.readyState !== WebSocket.OPEN) {
            return;
          }

          ws.send(JSON.stringify({ type: 'update', ...update }));
        },
        broadcastLeaderboard: () => {},
      } satisfies MultiplayerConnection;
    };

    const setupSupabaseRealtime = async () => {
      const supabase = getSupabaseClient();
      if (!supabase) {
        return null;
      }

      const playerId = crypto.randomUUID();
      const channel = supabase.channel('apex-racer-room', {
        config: {
          broadcast: { self: false },
          presence: { key: playerId },
        },
      });

      channel.on<CarUpdate>('broadcast', { event: 'car-update' }, ({ payload }) => {
        if (payload.id === playerId) {
          return;
        }

        const existingPlayer = remotePlayers.current.get(payload.id);
        if (existingPlayer) {
          applyCarUpdate(existingPlayer, payload);
          return;
        }

        // An update can arrive before presence tells us who this is
        remotePlayers.current.set(payload.id, { ...payload, initials: '???', color: '#94a3b8' });
      });

      channel.on('broadcast', { event: 'leaderboard' }, () => {
        if (!cancelled) {
          void loadLeaderboard();
        }
      });

      // Joins and leaves are always followed by a sync, which carries the full state
      channel.on('presence', { event: 'sync' }, () => {
        syncRemotePlayersFromPresence(flattenPresencePlayers(channel.presenceState<PresencePlayer>()));
      });

      await new Promise<void>((resolve, reject) => {
        channel.subscribe(async (status, error) => {
          if (status === 'SUBSCRIBED') {
            try {
              const existingPlayers = flattenPresencePlayers(channel.presenceState<PresencePlayer>());
              const slotIndex = getFirstOpenSlot(existingPlayers.map((player) => player.slotIndex));
              const placement = getGridPlacement(slotIndex);

              myIdRef.current = playerId;
              myColorRef.current = placement.color;
              car.current.x = placement.x;
              car.current.y = placement.y;
              car.current.vx = 0;
              car.current.vy = 0;
              car.current.angle = 0;

              await channel.track({
                id: playerId,
                initials: playerInitials,
                color: placement.color,
                slotIndex,
                x: placement.x,
                y: placement.y,
                angle: 0,
                vx: 0,
                vy: 0,
              } satisfies PresencePlayer);

              resolve();
            } catch (trackError) {
              reject(trackError);
            }
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            reject(error ?? new Error(`Supabase Realtime subscription failed with status ${status}`));
          }
        });
      });

      return {
        close: () => {
          void channel.untrack();
          void supabase.removeChannel(channel);
        },
        sendUpdate: (update: CarUpdate) => {
          void channel.send({
            type: 'broadcast',
            event: 'car-update',
            payload: update,
          });
        },
        broadcastLeaderboard: () => {
          void channel.send({
            type: 'broadcast',
            event: 'leaderboard',
          });
        },
      } satisfies MultiplayerConnection;
    };

    const initializeMultiplayer = async () => {
      if (hasSupabaseRealtimeConfig()) {
        try {
          const connection = await setupSupabaseRealtime();
          if (cancelled) {
            connection?.close();
            return;
          }

          multiplayerRef.current = connection;
          return;
        } catch (error) {
          console.error('Unable to connect to Supabase Realtime', error);
        }
      } else if (isVercelHost) {
        console.warn(
          `Supabase Realtime is not configured. Missing env vars: ${getMissingSupabaseRealtimeEnvVars().join(', ')}`,
        );
      }

      if (!isVercelHost) {
        multiplayerRef.current = setupLocalWebSocketConnection();
      }
    };

    void initializeMultiplayer();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'l' && !e.repeat) {
        setHeadlightsOn((on) => !on);
      }
      keys.current[e.key.toLowerCase()] = true;
      if (e.code === 'Space') keys.current.space = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false;
      if (e.code === 'Space') keys.current.space = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // V2 headlights are painted here first, then laid over the scene
    const lightCanvas = document.createElement('canvas');
    const lightCtx = lightCanvas.getContext('2d');

    // Classic renders at 1 canvas pixel per CSS pixel; V2 renders at the
    // device pixel ratio so it stays sharp on high-density screens.
    let pixelRatio = 1;
    // Size from the canvas element, not window.inner*: on iOS those include
    // space under the browser toolbars.
    let viewWidth = canvas.clientWidth || window.innerWidth;
    let viewHeight = canvas.clientHeight || window.innerHeight;
    const resize = () => {
      pixelRatio = graphicsModeRef.current === 'v2' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      viewWidth = canvas.clientWidth || window.innerWidth;
      viewHeight = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(viewWidth * pixelRatio);
      canvas.height = Math.round(viewHeight * pixelRatio);
      // Light is soft, so a 1x buffer looks the same and costs a quarter of 2x
      lightCanvas.width = Math.round(viewWidth);
      lightCanvas.height = Math.round(viewHeight);
    };
    window.addEventListener('resize', resize);
    // Also catches iOS toolbars collapsing, which does not always fire resize
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resizeCanvasRef.current = resize;
    resize();

    let animationId: number;
    let cameraX = viewWidth / 2;
    let cameraY = viewHeight / 2;
    let zoom = 1;
    let lastHudUpdate = 0;

    const loop = (time: number) => {
      const c = car.current;
      const state = gameState.current;
      const prevX = c.x;
      const isDestroyed = isDestroyedRef.current;

      // --- Physics ---
      const isAccelerating = !isDestroyed && (keys.current['arrowup'] || keys.current['w']);
      const isBraking = !isDestroyed && (keys.current['arrowdown'] || keys.current['s'] || keys.current.space);
      const isTurningLeft = !isDestroyed && (keys.current['arrowleft'] || keys.current['a']);
      const isTurningRight = !isDestroyed && (keys.current['arrowright'] || keys.current['d']);
      const steerInput = (isTurningRight ? 1 : 0) - (isTurningLeft ? 1 : 0);

      const forwardX = Math.cos(c.angle);
      const forwardY = Math.sin(c.angle);
      const rightX = Math.cos(c.angle + Math.PI/2);
      const rightY = Math.sin(c.angle + Math.PI/2);

      const speed = c.vx * forwardX + c.vy * forwardY;
      const lateralSpeed = c.vx * rightX + c.vy * rightY;

      const dist = getDistanceToTrack(c);
      const isOnTrack = dist < HALF_TRACK_WIDTH;
      const isDrifting = isOnTrack && isBraking && steerInput !== 0 && Math.abs(speed) > 2.5;

      const engineForce = isOnTrack ? 0.6 : 0.3;
      const brakingForce = isOnTrack ? (isDrifting ? 0.22 : 0.8) : 0.4;
      const turnSpeed = isDrifting ? 0.072 : 0.05;
      const drag = isOnTrack ? (isDrifting ? 0.985 : 0.97) : 0.90;
      const grip = isOnTrack ? (isDrifting ? 0.045 : 0.15) : 0.05;

      if (isAccelerating) {
        c.vx += forwardX * engineForce;
        c.vy += forwardY * engineForce;
      }
      if (isBraking) {
        const brakeAmount = Math.min(Math.abs(speed), brakingForce);
        const brakeDirection = speed === 0 ? 0 : Math.sign(speed);
        c.vx -= forwardX * brakeAmount * brakeDirection;
        c.vy -= forwardY * brakeAmount * brakeDirection;
      }

      if (Math.abs(speed) > 0.5) {
        const turnDir = speed > 0 ? 1 : -1;
        if (isTurningLeft) c.angle -= turnSpeed * turnDir;
        if (isTurningRight) c.angle += turnSpeed * turnDir;
      }

      if (isDrifting) {
        const driftPush = Math.min(Math.abs(speed) * 0.03, 0.75);
        c.vx += rightX * steerInput * driftPush;
        c.vy += rightY * steerInput * driftPush;
      }

      // Apply lateral friction (grip)
      c.vx -= rightX * lateralSpeed * grip;
      c.vy -= rightY * lateralSpeed * grip;

      // Apply drag
      c.vx *= drag;
      c.vy *= drag;

      // Remove any backward motion so brake input acts like a drift brake, not reverse.
      const nextForwardSpeed = c.vx * forwardX + c.vy * forwardY;
      if (nextForwardSpeed < 0) {
        c.vx -= forwardX * nextForwardSpeed;
        c.vy -= forwardY * nextForwardSpeed;
      }

      c.x += c.vx;
      c.y += c.vy;

      // Tyre effects are always simulated; each renderer picks what to draw
      const groundSpeed = Math.hypot(c.vx, c.vy);
      const isSkidding = Math.abs(lateralSpeed) > (isDrifting ? 1.5 : 3) && isOnTrack;
      const isRutting = !isOnTrack && groundSpeed > 2;
      const rearWheels = [-11, 11].map(side => ({
        x: c.x + rightX * side - forwardX * 16,
        y: c.y + rightY * side - forwardY * 16,
      }));
      const markSurface = isRutting ? 'grass' : isSkidding ? 'road' : null;
      if (markSurface) {
        if (markSurface !== skidStreak.current.surface) {
          skidStreak.current.id++;
        }
        rearWheels.forEach((wheel, side) => {
          skidMarks.current.push({
            ...wheel,
            life: 1.0,
            side: side as 0 | 1,
            streak: skidStreak.current.id,
            surface: isRutting ? 'grass' : undefined,
          });
        });
      }
      skidStreak.current.surface = markSurface;
      if (isRutting) {
        for (const wheel of rearWheels) {
          spawnGrass(grassParticles.current, wheel.x, wheel.y, c.vx, c.vy, forwardX, forwardY, groundSpeed);
        }
      }
      if (isSkidding && Math.random() < 0.7) {
        const wheel = rearWheels[Math.random() < 0.5 ? 0 : 1];
        spawnSmoke(smokeParticles.current, wheel.x, wheel.y, c.vx, c.vy);
      }
      updateSmoke(smokeParticles.current);
      updateGrass(grassParticles.current);

      for (let i = skidMarks.current.length - 1; i >= 0; i--) {
        skidMarks.current[i].life -= 0.02;
        if (skidMarks.current[i].life <= 0) {
          skidMarks.current.splice(i, 1);
        }
      }

      // --- Multiplayer Send ---
      if (multiplayerRef.current && time - lastSendTime.current > 50) {
        multiplayerRef.current.sendUpdate({
          id: myIdRef.current ?? 'local',
          x: c.x,
          y: c.y,
          angle: c.angle,
          vx: c.vx,
          vy: c.vy,
          lights: headlightsOnRef.current,
        });
        lastSendTime.current = time;
      }

      // --- Dead Reckoning for Remote Players ---
      remotePlayers.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
      });

      // --- Game Logic ---
      if (state.nextCheckpoint < checkpoints.length) {
        const cp = checkpoints[state.nextCheckpoint];
        if (dist2(c, cp) < 400 * 400) {
          state.nextCheckpoint++;
        }
      } else {
        if (
          prevX < START_FINISH_X &&
          c.x >= START_FINISH_X &&
          Math.abs(c.y - START_FINISH_Y) < HALF_TRACK_WIDTH
        ) {
          if (playerInitials === EASTER_EGG_INITIALS) {
            const currentLapTime = time - state.lapStartTime;
            explosionParticles.current.push(...createExplosionBurst(c.x, c.y, myColorRef.current));
            isDestroyedRef.current = true;
            c.vx = 0;
            c.vy = 0;
            state.nextCheckpoint = 0;
            state.lapStartTime = time;
            setLapCelebrationMessage(null);
            setSpeedMph(0);
            setLapTime(Math.max(0, currentLapTime));
          } else {
          // Lap complete!
            const currentLapTime = time - state.lapStartTime;
            const currentLapPlacement = getBestLeaderboardPlacement(currentLapTime, leaderboardRef.current);
            setLastLap(currentLapTime);
            setBestLap(prev => prev === null ? currentLapTime : Math.min(prev, currentLapTime));
            void saveLapTime(currentLapTime);
            if (currentLapPlacement !== null) {
              const confettiColors = currentLapPlacement < 3
                ? PODIUM_CONFETTI_COLORS[currentLapPlacement]
                : CONFETTI_COLORS;
              setLapCelebrationMessage('NEW RECORD!!!');
              confettiParticles.current.push(
                ...createConfettiBurst('left', viewWidth, viewHeight, confettiColors),
                ...createConfettiBurst('right', viewWidth, viewHeight, confettiColors),
              );
            } else {
              setLapCelebrationMessage(null);
            }
            setLap(l => l + 1);
            state.nextCheckpoint = 0;
            state.lapStartTime = time;
          }
        }
      }

      // Update the HUD at most ~30 times a second; re-rendering the whole
      // component every frame costs more than the readout needs
      if (time - lastHudUpdate >= HUD_UPDATE_INTERVAL_MS) {
        lastHudUpdate = time;
        setLapReadyToFinish(state.nextCheckpoint >= checkpoints.length);
        if (isDestroyed) {
          setSpeedMph(0);
        } else {
          setSpeedMph(Math.abs(Math.round(speed * 3.1)));
          setLapTime(Math.max(0, time - state.lapStartTime));
        }
      }

      // --- Camera ---
      const targetCameraX = viewWidth / 2 - (c.x + c.vx * 15);
      const targetCameraY = viewHeight / 2 - (c.y + c.vy * 15);
      cameraX += (targetCameraX - cameraX) * 0.1;
      cameraY += (targetCameraY - cameraY) * 0.1;

      // --- Rendering ---
      if (graphicsModeRef.current === 'v2') {
        const speedRatio = Math.min(1, Math.hypot(c.vx, c.vy) / V2_TOP_SPEED);
        const targetZoom = (V2_ZOOM + (V2_ZOOM_AT_SPEED - V2_ZOOM) * speedRatio) * getViewportZoomScale(viewWidth, viewHeight);
        zoom += (targetZoom - zoom) * 0.05;
        renderV2(isDestroyed, isBraking, steerInput);
      } else {
        zoom = 1;
        renderClassic(isDestroyed);
      }

      animationId = requestAnimationFrame(loop);
    };

    // Draws the world in V2 style around the camera focus, then screen overlays.
    const renderV2 = (isDestroyed: boolean, isBraking: boolean, steerInput: number) => {
      const c = car.current;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      const focusX = viewWidth / 2 - cameraX;
      const focusY = viewHeight / 2 - cameraY;
      const halfW = viewWidth / 2 / zoom;
      const halfH = viewHeight / 2 / zoom;

      ctx.save();
      ctx.translate(viewWidth / 2, viewHeight / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-focusX, -focusY);

      drawGrassV2(ctx, focusX - halfW, focusY - halfH, focusX + halfW, focusY + halfH);
      drawTrackV2(ctx);
      drawSkidMarksV2(ctx, skidMarks.current);
      drawSmoke(ctx, smokeParticles.current);
      drawGrass(ctx, grassParticles.current);

      const localLights = headlightsOnRef.current && !isDestroyed ? 1 : 0;

      remotePlayers.current.forEach(p => {
        drawCarV2(ctx, p.x, p.y, p.angle, p.color, { lights: remoteLightStrength(p) });
      });

      drawExplosion();

      if (!isDestroyed) {
        drawCarV2(ctx, c.x, c.y, c.angle, myColorRef.current, { steer: steerInput, braking: isBraking, lights: localLights });
      }

      // Headlights go on after the cars so they light up any bodywork they hit,
      // with shadows cut out behind every car in a beam. Cars whose beams
      // cannot reach the screen are skipped, and so is the layer if none can.
      const cars = [
        ...Array.from(remotePlayers.current.values(), (p: RemotePlayer) => ({
          id: p.id, x: p.x, y: p.y, angle: p.angle, strength: remoteLightStrength(p) * 0.9,
        })),
        ...(isDestroyed ? [] : [{ id: myIdRef.current ?? 'local', x: c.x, y: c.y, angle: c.angle, strength: localLights }]),
      ];
      const reachX = halfW + HEADLIGHT_REACH;
      const reachY = halfH + HEADLIGHT_REACH;
      const lightSources = cars.filter(car =>
        car.strength > 0 && Math.abs(car.x - focusX) < reachX && Math.abs(car.y - focusY) < reachY,
      );
      if (lightCtx && lightSources.length > 0) {
        const world = ctx.getTransform();
        lightCtx.setTransform(1, 0, 0, 1, 0, 0);
        lightCtx.clearRect(0, 0, lightCanvas.width, lightCanvas.height);
        // Same world transform as the scene, minus the device pixel ratio
        lightCtx.setTransform(new DOMMatrix().scale(1 / pixelRatio).multiply(world));
        drawLightLayerV2(lightCtx, lightSources, cars);

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(lightCanvas, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      // Tags last so no car ever covers a name
      remotePlayers.current.forEach(p => {
        drawDriverTag(ctx, p.x, p.y, p.initials, p.color);
      });

      ctx.restore();

      drawConfetti();

      const minimap = minimapRef.current;
      if (minimap) {
        drawMinimap(
          minimap,
          { x: c.x, y: c.y, angle: c.angle, color: myColorRef.current },
          remotePlayers.current.values(),
        );
      }
    };

    const drawExplosion = () => {
      for (let i = explosionParticles.current.length - 1; i >= 0; i--) {
        const particle = explosionParticles.current[i];
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.94;
        particle.vy *= 0.94;
        particle.life -= 1;

        if (particle.life <= 0) {
          explosionParticles.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.globalAlpha = Math.min(1, particle.life / 16);
        ctx.fillStyle = particle.color;
        ctx.shadowColor = particle.color;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(0, 0, particle.size * (particle.life / 36), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    const drawConfetti = () => {
      for (let i = confettiParticles.current.length - 1; i >= 0; i--) {
        const particle = confettiParticles.current[i];
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.992;
        particle.vy += 0.35;
        particle.rotation += particle.spin;
        particle.life -= 1;

        if (particle.life <= 0 || particle.y > viewHeight + 120) {
          confettiParticles.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.globalAlpha = Math.min(1, particle.life / 18);
        ctx.fillStyle = particle.color;

        if (particle.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, particle.size * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-particle.size / 2, -particle.size * 0.35, particle.size, particle.size * 0.7);
        }

        ctx.restore();
      }
    };

    const renderClassic = (isDestroyed: boolean) => {
      const c = car.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      ctx.fillStyle = '#166534'; // Grass
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(cameraX, cameraY);

      // Grass details
      ctx.fillStyle = '#14532d';
      const dotSpacing = 150;
      const startX = Math.floor(-cameraX / dotSpacing) * dotSpacing;
      const startY = Math.floor(-cameraY / dotSpacing) * dotSpacing;
      const endX = startX + canvas.width + dotSpacing;
      const endY = startY + canvas.height + dotSpacing;

      for (let x = startX; x < endX; x += dotSpacing) {
        for (let y = startY; y < endY; y += dotSpacing) {
          const offsetX = (Math.sin(x * 12.345 + y * 67.89) * 40);
          const offsetY = (Math.cos(x * 98.76 + y * 54.321) * 40);
          ctx.beginPath();
          ctx.arc(x + offsetX, y + offsetY, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Track
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      traceTrack(ctx);
      ctx.lineWidth = TRACK_WIDTH;
      ctx.strokeStyle = '#333';
      ctx.stroke();

      // Center line
      traceTrack(ctx);
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.setLineDash([40, 40]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Start/Finish line
      ctx.save();
      ctx.translate(START_FINISH_X, START_FINISH_Y);
      const dx = trackPoints[1].x - trackPoints[0].x;
      const dy = trackPoints[1].y - trackPoints[0].y;
      const startFinishHalfHeight = HALF_TRACK_WIDTH;
      const startFinishTop = -startFinishHalfHeight;
      const startFinishHeight = startFinishHalfHeight * 2;
      ctx.rotate(Math.atan2(dy, dx));
      
      ctx.fillStyle = '#fff';
      ctx.fillRect(-START_FINISH_LINE_WIDTH / 2, startFinishTop, START_FINISH_LINE_WIDTH, startFinishHeight);
      ctx.fillStyle = '#000';
      for (let i = startFinishTop; i < startFinishHalfHeight; i += 40) {
        ctx.fillRect(-START_FINISH_LINE_WIDTH / 2, i, START_FINISH_LINE_WIDTH / 2, 20);
        ctx.fillRect(0, i + 20, START_FINISH_LINE_WIDTH / 2, 20);
      }
      ctx.restore();

      // Skid marks
      skidMarks.current.forEach(mark => {
        if (mark.surface === 'grass') return; // V2-only ruts
        ctx.fillStyle = `rgba(0, 0, 0, ${mark.life * 0.4})`;
        ctx.beginPath();
        ctx.arc(mark.x, mark.y, 5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Remote Cars
      remotePlayers.current.forEach(p => {
        drawCar(ctx, p.x, p.y, p.angle, p.color, false);
        drawDriverTag(ctx, p.x, p.y, p.initials, p.color);
      });

      // Local Car
      drawExplosion();

      if (!isDestroyed) {
        drawCar(ctx, c.x, c.y, c.angle, myColorRef.current, headlightsOnRef.current);
      }

      ctx.restore();

      drawConfetti();
    };
    animationId = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      multiplayerRef.current?.close();
      multiplayerRef.current = null;
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
      resizeObserver.disconnect();
      resizeCanvasRef.current = null;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [playerInitials]);

  const handleJoin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextInitials = normalizeInitials(initialsInput);
    if (nextInitials.length === 0) {
      return;
    }

    setPlayerInitials(nextInitials);
  };

  const handleResetLeaderboard = async () => {
    if (isResettingLeaderboard) {
      return;
    }

    const confirmed = window.confirm('Reset today\'s leaderboard records only? All-time scores will stay.');
    if (!confirmed) {
      return;
    }

    setIsResettingLeaderboard(true);
    if (await updateLeaderboard(() => resetLeaderboard(clientTimeZone.current))) {
      setLapCelebrationMessage(null);
      multiplayerRef.current?.broadcastLeaderboard();
    }
    setIsResettingLeaderboard(false);
  };

  const currentLapDisplay = formatTime(lapTime);
  const currentLapPlacement = playerInitials && lapReadyToFinish
    ? getBestLeaderboardPlacement(lapTime, leaderboard, PODIUM.length)
    : null;
  const currentLapPodium = currentLapPlacement === null ? null : PODIUM[currentLapPlacement];
  const currentLapMedalBadge = currentLapPodium && (
    <span
      aria-label={`Current lap is on ${currentLapPodium.label} pace`}
      role="img"
      title={`Current lap is on ${currentLapPodium.label} pace`}
    >
      {currentLapPodium.emoji}
    </span>
  );
  const leaderboardSlots = Array.from({ length: LEADERBOARD_LIMIT }, (_, index) => index);
  const isLeaderboardLoading = leaderboardStatus === 'loading';

  const renderLeaderboardList = (entries: LeaderboardEntry[], keyPrefix: string) => (
    <div className="space-y-2">
      {isLeaderboardLoading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.28em] text-white/45 animate-pulse">
          Loading top scores...
        </div>
      ) : (
        leaderboardSlots.map((index) => {
          const entry = entries[index];
          return (
            <div key={`${keyPrefix}-${index}`} className="flex items-center justify-between gap-4 text-sm sm:gap-6">
              <span className="text-white/80">
                {`#${index + 1} `}
                <span className="font-bold">{entry?.initials ?? '---'}</span>
              </span>
              <span className={entry ? 'font-bold text-cyan-100' : 'text-white/30'}>
                {formatTime(entry?.timeMs)}
              </span>
            </div>
          );
        })
      )}
    </div>
  );

  const renderLapRow = (label: string, ms: number | null, colorClass: string) => (
    <div className="flex items-center justify-between gap-4 sm:gap-6">
      <span className="text-xs uppercase tracking-widest text-gray-400">{label}</span>
      <span className={`text-base font-bold sm:text-lg ${ms === null ? 'text-white/30' : colorClass}`}>
        {formatTime(ms)}
      </span>
    </div>
  );

  // Press-and-hold handlers for an on-screen control that stands in for a key
  const holdKey = (key: string) => {
    const set = (down: boolean) => (event: React.PointerEvent) => {
      event.preventDefault();
      keys.current[key] = down;
    };
    return { onPointerDown: set(true), onPointerUp: set(false), onPointerLeave: set(false) };
  };
  const controlButtonClass = 'bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white active:bg-white/30 select-none touch-none';

  const hudToggleButton = (
    <button
      aria-expanded={isHudOpen}
      aria-label={isHudOpen ? 'Collapse race HUD' : 'Expand race HUD'}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-[0.98]"
      onClick={() => setIsHudOpen((open) => !open)}
      type="button"
    >
      {isHudOpen ? (
        <svg fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="20">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      ) : (
        <svg fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="20">
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      )}
    </button>
  );
  const compactHud = (
    <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/10 bg-black/70 px-3 py-3 text-white shadow-xl backdrop-blur-md">
      {hudToggleButton}

      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/45">
          Lap {lap}
        </div>
        <div className="mt-1 flex items-center gap-2 font-mono">
          <span className="text-lg font-bold text-yellow-400">{currentLapDisplay}</span>
          {currentLapMedalBadge}
        </div>
      </div>
    </div>
  );

  const isV2 = graphicsMode === 'v2';
  const graphicsToggle = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <span id="graphics-mode-label" className="text-xs uppercase tracking-widest text-gray-400">Graphics</span>
      <div
        aria-labelledby="graphics-mode-label"
        className="pointer-events-auto relative grid w-28 grid-cols-2 rounded-full border border-white/10 bg-white/5 p-1"
        role="radiogroup"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-gradient-to-r from-rose-500 to-orange-400 shadow-lg transition-transform duration-300 ease-out"
          style={{ transform: isV2 ? 'translateX(100%)' : 'translateX(0)' }}
        />
        {(['classic', 'v2'] as const).map((mode) => (
          <button
            aria-checked={graphicsMode === mode}
            className={`relative z-10 rounded-full py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
              graphicsMode === mode ? 'text-white' : 'text-white/50 hover:text-white/80'
            }`}
            key={mode}
            onClick={() => setGraphicsMode(mode)}
            role="radio"
            type="button"
          >
            {mode === 'classic' ? 'V1' : 'V2'}
          </button>
        ))}
      </div>
    </div>
  );

  const hudDetails = (
    <>
      <h1 className="mb-1 bg-gradient-to-r from-rose-400 to-orange-400 bg-clip-text text-xl font-black italic tracking-wider text-transparent sm:text-2xl">
        APEX RACER
      </h1>
      <p className="mb-4 text-xs font-medium text-gray-300 sm:text-sm">WASD or Arrows to drive, L for lights</p>
      {graphicsToggle}

      <div className="space-y-2 font-mono">
        <div className="flex items-center justify-between gap-4 sm:gap-6">
          <span className="text-xs uppercase tracking-widest text-gray-400">Lap</span>
          <span className="text-lg font-bold sm:text-xl">{lap}</span>
        </div>
        <div className="flex items-center justify-between gap-4 sm:gap-6">
          <span className="text-xs uppercase tracking-widest text-gray-400">Time</span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-yellow-400 sm:text-xl">{currentLapDisplay}</span>
            {currentLapMedalBadge}
          </div>
        </div>
        {renderLapRow('Last lap', lastLap, 'text-cyan-100')}
        {renderLapRow('Best lap', bestLap, 'text-green-400')}
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs uppercase tracking-widest text-gray-400">Top {LEADERBOARD_LIMIT} All Time</div>
          {renderLeaderboardList(leaderboard.allTime, 'all-time')}
        </div>
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-widest text-gray-400">Top {LEADERBOARD_LIMIT} Today</span>
            <button
              className="pointer-events-auto rounded-full border border-rose-400/25 bg-rose-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.25em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isResettingLeaderboard || isLeaderboardLoading}
              onClick={() => {
                void handleResetLeaderboard();
              }}
              type="button"
            >
              {isResettingLeaderboard ? 'Resetting' : 'Reset'}
            </button>
          </div>
          {renderLeaderboardList(leaderboard.today, 'today')}
          {leaderboardStatus === 'error' && (
            <p className="mt-2 text-xs text-rose-300">Leaderboard unavailable</p>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-green-900 font-sans">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      
      {isV2 && (
        // Vignette as CSS so it is composited once instead of painted every frame
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(circle farthest-corner, rgba(2, 6, 23, 0) 45%, rgba(2, 6, 23, 0.4) 100%)' }}
        />
      )}

      {/* HUD */}
      <div className="pointer-events-none absolute top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] z-20 flex flex-col gap-3 sm:top-[max(1.5rem,env(safe-area-inset-top))] sm:left-[max(1.5rem,env(safe-area-inset-left))]">
        {(isMobileHud || !isHudOpen) && compactHud}
        {isHudOpen && (isMobileHud ? (
          <div className="pointer-events-auto max-h-[min(70vh,28rem)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl border border-white/10 bg-black/70 p-4 text-white shadow-2xl backdrop-blur-md">
            {hudDetails}
          </div>
        ) : (
          <div className="pointer-events-auto relative w-72 rounded-2xl border border-white/10 bg-black/60 p-5 pr-16 text-white shadow-xl backdrop-blur-md">
            <div className="absolute right-4 top-4">
              {hudToggleButton}
            </div>
            {hudDetails}
          </div>
        ))}
      </div>

      {lapCelebrationMessage && (
        <div className="pointer-events-none absolute top-5 left-1/2 z-30 -translate-x-1/2 px-4 sm:top-6">
          <div className="animate-pulse rounded-full border border-amber-200/40 bg-gradient-to-r from-amber-500/85 to-orange-500/85 px-5 py-3 text-center text-xs font-black uppercase tracking-[0.32em] text-white shadow-2xl backdrop-blur-md sm:text-sm">
            {lapCelebrationMessage}
          </div>
        </div>
      )}

      {isV2 ? (
        <div className="pointer-events-none absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] flex flex-col items-end gap-3 sm:top-[max(1.5rem,env(safe-area-inset-top))] sm:right-[max(1.5rem,env(safe-area-inset-right))]">
          <SpeedGauge mph={speedMph} />
          <canvas
            aria-label="Track map"
            className="w-24 rounded-2xl border border-white/10 bg-black/55 shadow-xl backdrop-blur-md sm:w-36"
            ref={minimapRef}
            role="img"
            style={{ aspectRatio: MINIMAP_ASPECT }}
          />
        </div>
      ) : (
        <div className="absolute top-6 right-6 bg-black/60 text-white p-6 rounded-3xl backdrop-blur-md border border-white/10 shadow-xl flex flex-col items-end pointer-events-none">
          <div className="text-5xl font-black italic tracking-tighter">
            {speedMph}
          </div>
          <div className="text-rose-400 font-bold tracking-widest text-sm uppercase mt-1">
            mph
          </div>
        </div>
      )}

      {/* On-screen Controls */}
      <div className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] left-[max(2rem,env(safe-area-inset-left))] flex gap-4">
        <button aria-label="Steer left" className={`h-16 w-16 ${controlButtonClass}`} type="button" {...holdKey('arrowleft')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <button aria-label="Steer right" className={`h-16 w-16 ${controlButtonClass}`} type="button" {...holdKey('arrowright')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>

      <div className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] right-[max(2rem,env(safe-area-inset-right))] flex gap-4 items-end">
        <button className={`mb-2 h-16 w-16 ${controlButtonClass}`} type="button" {...holdKey('arrowdown')}>
          <span className="font-bold text-xs uppercase tracking-wider">Brake</span>
        </button>
        <div className="flex flex-col items-center gap-6">
          <button
            aria-label={headlightsOn ? 'Turn headlights off (L)' : 'Turn headlights on (L)'}
            aria-pressed={headlightsOn}
            className={`flex h-12 w-12 select-none items-center justify-center rounded-full border backdrop-blur-md transition touch-none ${
              headlightsOn
                ? 'border-amber-200/60 bg-amber-300/90 text-slate-900 shadow-[0_0_18px_rgba(252,211,77,0.55)]'
                : 'border-white/20 bg-black/50 text-white/70'
            }`}
            onPointerDown={(e) => { e.preventDefault(); setHeadlightsOn((on) => !on); }}
            title="Headlights (L)"
            type="button"
          >
            <svg fill="none" height="22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="22">
              <path d="M14 6c3.6 0 6.5 2.7 6.5 6s-2.9 6-6.5 6c-.8 0-1.3-.5-1.3-1.3V7.3c0-.8.5-1.3 1.3-1.3Z" />
              <path d="M3 8h6.5" />
              <path d="M3 12h6.5" />
              <path d="M3 16h6.5" />
              {!headlightsOn && <path d="M3 3l18 18" />}
            </svg>
          </button>
          <button
            className="w-20 h-20 bg-rose-500/80 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white active:bg-rose-400 select-none touch-none"
            type="button"
            {...holdKey('arrowup')}
          >
            <span className="font-bold text-sm uppercase tracking-wider">Gas</span>
          </button>
        </div>
      </div>

      {!playerInitials && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm px-6">
          <form
            onSubmit={handleJoin}
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-black/70 p-7 text-white shadow-2xl"
          >
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-rose-300">Join Race</p>
            <h2 className="mt-3 text-3xl font-black italic tracking-tight text-white">Enter Your Initials</h2>
            <p className="mt-3 text-sm text-slate-300">
              Pick up to 3 letters so other drivers can see who is on the track.
            </p>

            <input
              autoFocus
              autoCapitalize="characters"
              className="mt-6 w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-center text-3xl font-black uppercase tracking-[0.45em] text-cyan-100 outline-none transition focus:border-cyan-400"
              maxLength={3}
              onChange={(event) => setInitialsInput(normalizeInitials(event.target.value))}
              placeholder="ABC"
              spellCheck={false}
              value={initialsInput}
            />

            <button
              className="mt-5 w-full rounded-2xl bg-gradient-to-r from-rose-500 to-orange-400 px-4 py-3 text-sm font-black uppercase tracking-[0.3em] text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={initialsInput.length === 0}
              type="submit"
            >
              Start Engines
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
