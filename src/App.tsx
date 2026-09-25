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
  drawParkingLotV2,
  drawRampsV2,
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
import {
  advanceClock,
  createFixedClock,
  easeForFrame,
  lerp,
  NO_INPUT,
  PHYSICS_HZ,
  stepCar,
  type CarState,
  type DriveInput,
  type StepInfo,
} from './physics';
import { CHECKPOINTS, createLapState, updateLap, type LapEvent } from './lap';
import {
  formatGap,
  loadBestLap,
  recordSample,
  sampleGhost,
  saveBestLap,
  startRecording,
  ticksToMs,
  type GhostLap,
  type GhostRecording,
} from './ghost';
import {
  applyNetworkState,
  createRemoteCar,
  remoteDrawState,
  stepRemoteCar,
  type NetworkCarState,
  type RemoteCar,
} from './remote';
import { RaceSound } from './sound';
import {
  createAirState,
  heightScale,
  isAirborne,
  rampsInRect,
  stepStuntCar,
  type Ramp,
  type StuntEvent,
} from './stuntPark';

const DEFAULT_START = getGridSlotPosition(0);

type PresencePlayer = NetworkCarState & {
  id: string;
  initials: string;
  color: string;
  slotIndex: number;
  lights?: boolean;
};

type CarUpdate = NetworkCarState & { id: string; lights?: boolean };

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

/** A short message under the top of the screen: a split gap or a lap that did not count. */
type LapFlash = { id: number; text: string; tone: 'ahead' | 'behind' | 'warn' | 'trick' };

type LevelId = 'circuit' | 'stunt';
const LEVELS: { id: LevelId; name: string; blurb: string }[] = [
  { id: 'circuit', name: 'Circuit', blurb: 'Timed laps and the leaderboard' },
  { id: 'stunt', name: 'Stunt Park', blurb: 'An endless lot full of jumps' },
];

/** What you have done in Stunt Park this session. */
type StuntStats = { jumps: number; lastAirMs: number | null; bestAirMs: number | null; bestSpinDeg: number };
const EMPTY_STUNT_STATS: StuntStats = { jumps: 0, lastAirMs: null, bestAirMs: null, bestSpinDeg: 0 };

// Touch screens and short or narrow windows start with the small HUD, so the
// full panel never covers the on-screen driving controls
const COMPACT_HUD_QUERY = '(max-width: 767px), (max-height: 499px), (pointer: coarse)';
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
const LEVEL_STORAGE_KEY = 'apex-racer:level';
const ADMIN_TOKEN_STORAGE_KEY = 'apex-racer:admin-token';
const HUD_UPDATE_INTERVAL_MS = 33;
const LAP_FLASH_MS = 2500;
const GHOST_COLOR = '#e2e8f0';
const GHOST_ALPHA = 0.35;
/** Steps of "3, 2, 1" before the car is released, then how long "GO!" stays up. */
const COUNTDOWN_STEPS = 3 * PHYSICS_HZ;
const GO_DISPLAY_STEPS = Math.round(0.8 * PHYSICS_HZ);

// Driving keys by physical position (KeyW is the key where W sits on QWERTY),
// so WASD works on AZERTY and other layouts. Touch buttons use the Touch* names.
const DRIVING_KEYS = new Set([
  'KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'Space', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight',
]);

function readDriveInput(held: Record<string, boolean>): DriveInput {
  const left = held.KeyA || held.ArrowLeft || held.TouchLeft;
  const right = held.KeyD || held.ArrowRight || held.TouchRight;
  return {
    gas: Boolean(held.KeyW || held.ArrowUp || held.TouchGas),
    brake: Boolean(held.KeyS || held.ArrowDown || held.Space || held.TouchBrake),
    steer: (right ? 1 : 0) - (left ? 1 : 0),
  };
}

function loadLevel(): LevelId {
  try {
    return window.localStorage.getItem(LEVEL_STORAGE_KEY) === 'stunt' ? 'stunt' : 'circuit';
  } catch {
    return 'circuit';
  }
}

/** Spin in whole half-turns, as a trick name: 360, 540, 720... Null under a full turn. */
function spinTrickName(spin: number) {
  const halfTurns = Math.round(Math.abs(spin) / Math.PI);
  return halfTurns >= 2 ? `${halfTurns * 180}!` : null;
}

function loadGraphicsMode(): GraphicsMode {
  try {
    return window.localStorage.getItem(GRAPHICS_MODE_STORAGE_KEY) === 'classic' ? 'classic' : 'v2';
  } catch {
    return 'v2';
  }
}

/**
 * The leaderboard admin token, if this browser has one. Opening the game with
 * ?admin=TOKEN saves it (and ?admin= clears it); the query is then removed
 * from the address bar so it is not shared by accident.
 */
function loadAdminToken() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('admin')) {
      const token = url.searchParams.get('admin')?.trim() ?? '';
      if (token) {
        window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      }
      url.searchParams.delete('admin');
      window.history.replaceState(window.history.state, '', url.toString());
    }
    return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function forgetAdminToken() {
  try {
    window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    // Nothing stored, or storage blocked
  }
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
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

  // Windows (relative to the caller's alpha, so a ghost car stays see-through)
  const baseAlpha = ctx.globalAlpha;
  ctx.fillStyle = '#38bdf8'; // Sky 400
  ctx.globalAlpha = baseAlpha * 0.7;
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
  ctx.globalAlpha = baseAlpha;

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

/** A failed API call, keeping the HTTP status so callers can tell a rejected lap from an outage. */
class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function requestLeaderboard(errorMessage: string, init?: RequestInit, timeZone?: string) {
  const query = timeZone ? `?timeZone=${encodeURIComponent(timeZone)}` : '';
  const response = await fetch(`${import.meta.env.BASE_URL}api/leaderboard${query}`, init);
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(detail?.error ?? errorMessage, response.status);
  }

  const data = await response.json() as { leaderboard?: LeaderboardData };
  return data.leaderboard ?? emptyLeaderboardData();
}

const fetchLeaderboard = (timeZone: string) => requestLeaderboard('Unable to load leaderboard', undefined, timeZone);

const submitLapTime = (initials: string, timeMs: number, timeZone: string, lapToken: string) =>
  requestLeaderboard('Unable to save lap time', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initials, timeMs, timeZone, lapToken }),
  });

const resetLeaderboard = (timeZone: string, adminToken: string) =>
  requestLeaderboard('Unable to reset leaderboard', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  }, timeZone);

/** Asks the server to note when a lap started; the lap's submission must carry this token. */
async function requestLapToken() {
  const response = await fetch(`${import.meta.env.BASE_URL}api/lap-start`, { method: 'POST' });
  if (!response.ok) {
    throw new ApiError('Unable to start lap', response.status);
  }
  const data = await response.json() as { token?: string };
  return typeof data.token === 'string' ? data.token : null;
}

function remoteLightStrength(player: RemoteCar) {
  return player.lights === false ? 0 : 0.5;
}

function isCompactHudViewport() {
  return window.matchMedia(COMPACT_HUD_QUERY).matches;
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
  const [isCompactHud, setIsCompactHud] = useState(isCompactHudViewport);
  const [isHudOpen, setIsHudOpen] = useState(() => !isCompactHudViewport());
  const [lapReadyToFinish, setLapReadyToFinish] = useState(false);
  const [lapCelebrationMessage, setLapCelebrationMessage] = useState<string | null>(null);
  const [lapFlash, setLapFlash] = useState<LapFlash | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [isResettingLeaderboard, setIsResettingLeaderboard] = useState(false);
  const [adminToken, setAdminToken] = useState(loadAdminToken);
  const clientTimeZone = useRef(getClientTimeZone());
  const [graphicsMode, setGraphicsMode] = useState<GraphicsMode>(loadGraphicsMode);
  const graphicsModeRef = useRef(graphicsMode);
  const resizeCanvasRef = useRef<(() => void) | null>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const [headlightsOn, setHeadlightsOn] = useState(false);
  const headlightsOnRef = useRef(headlightsOn);
  const [sound] = useState(() => new RaceSound());
  const [muted, setMuted] = useState(sound.muted);
  const [level, setLevel] = useState<LevelId>(loadLevel);
  const [stuntStats, setStuntStats] = useState<StuntStats>(EMPTY_STUNT_STATS);

  // --- Multiplayer State ---
  const multiplayerRef = useRef<MultiplayerConnection | null>(null);
  const myIdRef = useRef<string | null>(null);
  const myColorRef = useRef<string>('#06b6d4');
  const remotePlayers = useRef<Map<string, RemoteCar>>(new Map());
  const lastSendTime = useRef<number>(0);
  const leaderboardRef = useRef<LeaderboardData>(emptyLeaderboardData());
  const confettiParticles = useRef<ConfettiParticle[]>([]);
  const explosionParticles = useRef<ExplosionParticle[]>([]);
  const isDestroyedRef = useRef(false);

  // Driving keys and touch buttons currently held, by KeyboardEvent.code or Touch* name
  const heldKeys = useRef<Record<string, boolean>>({});
  const car = useRef<CarState>({
    x: DEFAULT_START.x, y: DEFAULT_START.y,
    vx: 0, vy: 0,
    angle: 0,
  });
  const skidMarks = useRef<SkidMark[]>([]);
  const skidStreak = useRef<{ id: number; surface: 'road' | 'grass' | null }>({ id: 0, surface: null });
  const smokeParticles = useRef<SmokeParticle[]>([]);
  const grassParticles = useRef<GrassParticle[]>([]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(COMPACT_HUD_QUERY);

    const handleChange = (event: MediaQueryListEvent) => {
      setIsCompactHud(event.matches);
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
    if (!lapFlash) {
      return;
    }

    const timeoutId = window.setTimeout(() => setLapFlash(null), LAP_FLASH_MS);
    return () => window.clearTimeout(timeoutId);
  }, [lapFlash]);

  useEffect(() => {
    leaderboardRef.current = leaderboard;
  }, [leaderboard]);

  useEffect(() => {
    headlightsOnRef.current = headlightsOn;
  }, [headlightsOn]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LEVEL_STORAGE_KEY, level);
    } catch {
      // Blocked storage: the choice just won't persist
    }
  }, [level]);

  useEffect(() => {
    graphicsModeRef.current = graphicsMode;
    sound.setEnabled(graphicsMode === 'v2');
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

  const toggleMute = useCallback(() => {
    const next = !sound.muted;
    sound.setMuted(next);
    setMuted(next);
  }, [sound]);

  useEffect(() => {
    if (!playerInitials) {
      return;
    }

    let cancelled = false;

    const saveLapTime = async (timeMs: number, lapToken: Promise<string | null> | null) => {
      const token = await lapToken;
      if (cancelled) {
        return;
      }
      if (!token) {
        console.warn('Lap not saved: the server never confirmed when it started');
        return;
      }

      try {
        const next = await submitLapTime(playerInitials, timeMs, clientTimeZone.current, token);
        if (cancelled) {
          return;
        }
        setLeaderboard(next);
        setLeaderboardStatus('ready');
        multiplayerRef.current?.broadcastLeaderboard();
      } catch (error) {
        // 400: the server did not accept the lap; 409: it was already saved
        if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
          console.warn(`Lap not saved: ${error.message}`);
        } else {
          console.error(error);
          if (!cancelled) {
            setLeaderboardStatus('error');
          }
        }
      }
    };

    const isStunt = level === 'stunt';
    const c = car.current;
    Object.assign(c, { x: DEFAULT_START.x, y: DEFAULT_START.y, vx: 0, vy: 0, angle: 0 });
    // Where the car was one physics step ago, to draw it between steps
    const prevCar = { x: c.x, y: c.y, angle: c.angle, z: 0 };
    // Height and jump state in Stunt Park; stays on the ground on the circuit
    let air = createAirState();
    myColorRef.current = '#06b6d4';
    myIdRef.current = 'local';
    remotePlayers.current.clear();
    confettiParticles.current = [];
    explosionParticles.current = [];
    isDestroyedRef.current = false;
    heldKeys.current = {};
    setLap(1);
    setLapTime(0);
    setLastLap(null);
    setLapReadyToFinish(false);
    setLapCelebrationMessage(null);
    setLapFlash(null);
    setCountdown(null);
    setStuntStats(EMPTY_STUNT_STATS);
    // The WebSocket multiplayer server only exists in `npm run dev`
    const hasLocalServer = import.meta.env.DEV;
    multiplayerRef.current = null;

    // Race state that only the game loop touches. `tick` counts physics steps
    // since joining; lap times are measured in steps, not wall-clock time.
    let tick = 0;
    let lapState = createLapState();
    let ghost: GhostLap | null = isStunt ? null : loadBestLap(playerInitials);
    let recording: GhostRecording | null = null;
    let lapToken: Promise<string | null> | null = null;
    let flashCount = 0;
    let shownCountdown: string | null = null;
    setBestLap(ghost ? ticksToMs(ghost.ticks) : null);

    const flash = (text: string, tone: LapFlash['tone']) => {
      setLapFlash({ id: ++flashCount, text, tone });
    };

    const beginLapToken = () => {
      lapToken = requestLapToken().catch((error) => {
        console.warn(error);
        return null;
      });
    };

    /** Puts the car on a grid slot (the server or presence assigns one); the lap starts over. */
    const placeCar = (x: number, y: number) => {
      Object.assign(c, { x, y, vx: 0, vy: 0, angle: 0 });
      Object.assign(prevCar, { x, y, angle: 0, z: 0 });
      air = createAirState();
      lapState = createLapState();
      recording = null;
      lapToken = null;
    };

    const syncRemotePlayersFromPresence = (players: PresencePlayer[]) => {
      const nextPlayers = new Map<string, RemoteCar>();

      players.forEach((player) => {
        if (player.id === myIdRef.current) {
          return;
        }

        const existing = remotePlayers.current.get(player.id);
        if (existing) {
          existing.initials = player.initials;
          existing.color = player.color;
          nextPlayers.set(player.id, existing);
        } else {
          nextPlayers.set(player.id, createRemoteCar(player));
        }
      });

      remotePlayers.current = nextPlayers;
    };

    const setupLocalWebSocketConnection = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}?initials=${encodeURIComponent(playerInitials)}&level=${level}`;
      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'init') {
            myIdRef.current = msg.id;
            myColorRef.current = msg.color;
            placeCar(msg.x, msg.y);
            remotePlayers.current.clear();
            msg.players.forEach((p: PresencePlayer) => {
              if (p.id !== msg.id) remotePlayers.current.set(p.id, createRemoteCar(p));
            });
          } else if (msg.type === 'join') {
            remotePlayers.current.set(msg.player.id, createRemoteCar(msg.player));
          } else if (msg.type === 'update') {
            const p = remotePlayers.current.get(msg.id);
            if (p) {
              applyNetworkState(p, msg);
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
      // One room per level, so circuit racers and stunt drivers never overlap
      const channel = supabase.channel(isStunt ? 'apex-racer-stunt' : 'apex-racer-room', {
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
          applyNetworkState(existingPlayer, payload);
          return;
        }

        // An update can arrive before presence tells us who this is
        remotePlayers.current.set(payload.id, createRemoteCar({ ...payload, initials: '???', color: '#94a3b8' }));
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
              placeCar(placement.x, placement.y);

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
      } else if (!hasLocalServer) {
        console.warn(
          `Supabase Realtime is not configured. Missing env vars: ${getMissingSupabaseRealtimeEnvVars().join(', ')}`,
        );
      }

      if (hasLocalServer) {
        multiplayerRef.current = setupLocalWebSocketConnection();
      }
    };

    void initializeMultiplayer();

    const clearHeldKeys = () => {
      heldKeys.current = {};
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      sound.unlock();
      if (!e.repeat) {
        const key = e.key.toLowerCase();
        if (key === 'l') setHeadlightsOn((on) => !on);
        if (key === 'm' && graphicsModeRef.current === 'v2') toggleMute();
      }
      if (DRIVING_KEYS.has(e.code)) {
        // Also stops Space and the arrows from pressing a focused HUD button
        e.preventDefault();
        heldKeys.current[e.code] = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (DRIVING_KEYS.has(e.code)) {
        e.preventDefault();
        heldKeys.current[e.code] = false;
      }
    };
    // A key released while the window is in the background never sends keyup,
    // so forget everything held when focus or visibility is lost
    const handleVisibilityChange = () => {
      if (document.hidden) clearHeldKeys();
      sound.setPageVisible(!document.hidden);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearHeldKeys);
    document.addEventListener('visibilitychange', handleVisibilityChange);

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
    let cameraX = viewWidth / 2 - c.x;
    let cameraY = viewHeight / 2 - c.y;
    let zoom = 1;
    let lastHudUpdate = 0;
    let lastFrameTime: number | null = null;
    const clock = createFixedClock();
    // What the latest physics step saw, for the HUD, the renderer and the sound
    let lastStep: StepInfo | null = null;
    let lastInput: DriveInput = NO_INPUT;
    let isSkidding = false;
    let isRutting = false;

    // Shows 3, 2, 1, then GO! as the countdown steps pass, with a beep for each
    const countdownSteps = isStunt ? 0 : COUNTDOWN_STEPS;
    const updateCountdown = () => {
      if (isStunt) return;
      const remaining = COUNTDOWN_STEPS - tick;
      const value = remaining > 0
        ? String(Math.ceil(remaining / PHYSICS_HZ))
        : remaining > -GO_DISPLAY_STEPS ? 'GO!' : null;
      if (value !== shownCountdown) {
        shownCountdown = value;
        setCountdown(value);
        if (value) sound.countdownBeep(value === 'GO!');
      }
    };
    updateCountdown();

    const handleLapEvent = (event: LapEvent) => {
      if (event.type === 'start') {
        recording = startRecording(tick - lapState.startTick);
        beginLapToken();
        return;
      }

      if (event.type === 'checkpoint') {
        const bestSplit = ghost?.splits[event.index];
        if (bestSplit !== undefined) {
          const gapMs = ticksToMs(event.ticks - bestSplit);
          flash(formatGap(gapMs), gapMs <= 0 ? 'ahead' : 'behind');
        }
        return;
      }

      // The lap just finished; the next one began at the same crossing
      const finishedRecording = recording;
      const finishedToken = lapToken;
      const lapMs = ticksToMs(event.ticks);

      if (playerInitials === EASTER_EGG_INITIALS) {
        explosionParticles.current.push(...createExplosionBurst(c.x, c.y, myColorRef.current));
        isDestroyedRef.current = true;
        c.vx = 0;
        c.vy = 0;
        lapState = createLapState();
        recording = null;
        lapToken = null;
        sound.crash();
        setLapCelebrationMessage(null);
        setSpeedMph(0);
        setLapTime(lapMs);
        return;
      }

      recording = startRecording(tick - lapState.startTick);
      beginLapToken();
      setLap((n) => n + 1);

      if (event.interrupted) {
        flash('Lap not counted', 'warn');
        sound.invalidLap();
        setLapCelebrationMessage(null);
        return;
      }

      const isPersonalBest = !ghost || event.ticks < ghost.ticks;
      if (ghost) {
        const gapMs = lapMs - ticksToMs(ghost.ticks);
        flash(formatGap(gapMs), gapMs <= 0 ? 'ahead' : 'behind');
      }
      if (isPersonalBest) {
        ghost = {
          ticks: event.ticks,
          splits: event.splits,
          offset: finishedRecording?.offset ?? 0,
          samples: finishedRecording?.samples ?? [],
        };
        saveBestLap(playerInitials, ghost);
        setBestLap(lapMs);
      }
      setLastLap(lapMs);
      sound.lapChime(isPersonalBest);
      void saveLapTime(Math.round(lapMs), finishedToken);

      const placement = getBestLeaderboardPlacement(lapMs, leaderboardRef.current);
      if (placement !== null) {
        const confettiColors = placement < 3 ? PODIUM_CONFETTI_COLORS[placement] : CONFETTI_COLORS;
        setLapCelebrationMessage('NEW RECORD!!!');
        confettiParticles.current.push(
          ...createConfettiBurst('left', viewWidth, viewHeight, confettiColors),
          ...createConfettiBurst('right', viewWidth, viewHeight, confettiColors),
        );
      } else {
        setLapCelebrationMessage(null);
      }
    };

    const handleStuntEvent = (event: StuntEvent) => {
      if (event.type === 'launch') {
        sound.jump();
        return;
      }

      sound.land(event.impact / 12);
      // A puff of dust where the tyres hit
      for (let i = 0; i < 6; i++) {
        spawnSmoke(smokeParticles.current, c.x, c.y, c.vx * 0.3, c.vy * 0.3);
      }

      const airMs = ticksToMs(event.airTicks);
      const trick = spinTrickName(event.spin);
      const spinDeg = Math.round(Math.abs(event.spin) / Math.PI) * 180;
      setStuntStats((stats) => ({
        jumps: stats.jumps + 1,
        lastAirMs: airMs,
        bestAirMs: Math.max(stats.bestAirMs ?? 0, airMs),
        bestSpinDeg: trick ? Math.max(stats.bestSpinDeg, spinDeg) : stats.bestSpinDeg,
      }));
      const airText = `${(airMs / 1000).toFixed(1)}s`;
      if (trick) {
        flash(`${trick} ${airText}`, 'trick');
      } else if (airMs >= 900) {
        flash(`Big air ${airText}`, 'trick');
      }
    };

    const updateExplosion = () => {
      const particles = explosionParticles.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.94;
        particle.vy *= 0.94;
        particle.life -= 1;
        if (particle.life <= 0) {
          particles.splice(i, 1);
        }
      }
    };

    const updateConfetti = () => {
      const particles = confettiParticles.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.992;
        particle.vy += 0.35;
        particle.rotation += particle.spin;
        particle.life -= 1;
        if (particle.life <= 0 || particle.y > viewHeight + 120) {
          particles.splice(i, 1);
        }
      }
    };

    /** Everything that moves: one fixed 1/60 s step. */
    const simulateStep = (liveInput: DriveInput) => {
      prevCar.x = c.x;
      prevCar.y = c.y;
      prevCar.angle = c.angle;

      const racing = tick >= countdownSteps && !isDestroyedRef.current;
      const input = racing ? liveInput : NO_INPUT;
      prevCar.z = air.z;
      let step: StepInfo;
      if (isStunt) {
        const result = stepStuntCar(c, air, input);
        step = result.step;
        if (result.event) handleStuntEvent(result.event);
      } else {
        step = stepCar(c, input);
      }
      tick++;
      lastStep = step;
      lastInput = input;
      updateCountdown();

      // Tyre effects are always simulated; each renderer picks what to draw
      const groundSpeed = Math.hypot(c.vx, c.vy);
      isSkidding = Math.abs(step.lateralSpeed) > (step.isDrifting ? 1.5 : 3) && step.isOnTrack && !isAirborne(air);
      isRutting = !step.isOnTrack && groundSpeed > 2;
      const rearWheels = [-11, 11].map(side => ({
        x: c.x + step.rightX * side - step.forwardX * 16,
        y: c.y + step.rightY * side - step.forwardY * 16,
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
          spawnGrass(grassParticles.current, wheel.x, wheel.y, c.vx, c.vy, step.forwardX, step.forwardY, groundSpeed);
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

      updateExplosion();
      updateConfetti();
      remotePlayers.current.forEach(stepRemoteCar);

      const event = isStunt ? null : updateLap(lapState, prevCar, c, tick);
      if (event) {
        handleLapEvent(event);
      }
      if (recording && lapState.running) {
        recordSample(recording, c.x, c.y, c.angle);
      }
    };

    const loop = (time: number) => {
      const frameMs = lastFrameTime === null ? 0 : Math.min(100, time - lastFrameTime);
      lastFrameTime = time;

      const { steps, alpha, dropped } = advanceClock(clock, time);
      if (dropped && lapState.running) {
        // The game stalled (a hidden tab or a hang) and skipped time, so this lap can't be trusted
        lapState.interrupted = true;
      }
      const liveInput = readDriveInput(heldKeys.current);
      for (let i = 0; i < steps; i++) {
        simulateStep(liveInput);
      }

      const isDestroyed = isDestroyedRef.current;
      const groundSpeed = Math.hypot(c.vx, c.vy);
      const pose = {
        x: lerp(prevCar.x, c.x, alpha),
        y: lerp(prevCar.y, c.y, alpha),
        angle: lerp(prevCar.angle, c.angle, alpha),
        z: lerp(prevCar.z, air.z, alpha),
      };

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
          z: isStunt ? Math.round(air.z) : undefined,
        });
        lastSendTime.current = time;
      }

      sound.update({
        speedRatio: groundSpeed / V2_TOP_SPEED,
        throttle: lastInput.gas,
        skid: isSkidding ? Math.min(1, Math.abs(lastStep?.lateralSpeed ?? 0) / 8) : 0,
        rumble: isRutting ? Math.min(1, groundSpeed / 3) : 0,
        running: !isDestroyed,
      });

      // Update the HUD at most ~30 times a second; re-rendering the whole
      // component every frame costs more than the readout needs
      if (time - lastHudUpdate >= HUD_UPDATE_INTERVAL_MS) {
        lastHudUpdate = time;
        setLapReadyToFinish(lapState.running && lapState.nextCheckpoint >= CHECKPOINTS.length);
        if (isDestroyed) {
          setSpeedMph(0);
        } else {
          setSpeedMph(Math.abs(Math.round((lastStep?.speed ?? 0) * 3.1)));
          setLapTime(lapState.running ? ticksToMs(tick + alpha - lapState.startTick) : 0);
        }
      }

      // --- Camera ---
      const cameraEase = easeForFrame(0.1, frameMs);
      cameraX += (viewWidth / 2 - (pose.x + c.vx * 15) - cameraX) * cameraEase;
      cameraY += (viewHeight / 2 - (pose.y + c.vy * 15) - cameraY) * cameraEase;

      const ghostPose = ghost && lapState.running
        ? sampleGhost(ghost, tick + alpha - lapState.startTick)
        : null;

      // --- Rendering ---
      if (graphicsModeRef.current === 'v2') {
        const speedRatio = Math.min(1, groundSpeed / V2_TOP_SPEED);
        // Pull back a little while airborne so the landing stays in view
        const airPullBack = 1 - Math.min(0.2, pose.z / 900);
        const targetZoom = (V2_ZOOM + (V2_ZOOM_AT_SPEED - V2_ZOOM) * speedRatio) * getViewportZoomScale(viewWidth, viewHeight) * airPullBack;
        zoom += (targetZoom - zoom) * easeForFrame(0.05, frameMs);
        renderV2(isDestroyed, lastInput, pose, ghostPose, alpha);
      } else {
        zoom = 1;
        renderClassic(isDestroyed, pose, alpha);
      }

      animationId = requestAnimationFrame(loop);
    };

    type Pose = { x: number; y: number; angle: number; z?: number };

    // Draws the world in V2 style around the camera focus, then screen overlays.
    const renderV2 = (isDestroyed: boolean, input: DriveInput, pose: Pose, ghostPose: Pose | null, alpha: number) => {
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      const focusX = viewWidth / 2 - cameraX;
      const focusY = viewHeight / 2 - cameraY;
      const halfW = viewWidth / 2 / zoom;
      const halfH = viewHeight / 2 / zoom;

      ctx.save();
      ctx.translate(viewWidth / 2, viewHeight / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-focusX, -focusY);

      if (isStunt) {
        drawParkingLotV2(ctx, focusX - halfW, focusY - halfH, focusX + halfW, focusY + halfH);
        drawRampsV2(ctx, visibleRamps(focusX - halfW, focusY - halfH, focusX + halfW, focusY + halfH));
      } else {
        drawGrassV2(ctx, focusX - halfW, focusY - halfH, focusX + halfW, focusY + halfH);
        drawTrackV2(ctx);
      }
      drawSkidMarksV2(ctx, skidMarks.current);
      drawSmoke(ctx, smokeParticles.current);
      drawGrass(ctx, grassParticles.current);

      if (ghostPose) {
        ctx.save();
        ctx.globalAlpha = GHOST_ALPHA;
        drawCarV2(ctx, ghostPose.x, ghostPose.y, ghostPose.angle, GHOST_COLOR);
        ctx.restore();
      }

      const localLights = headlightsOnRef.current && !isDestroyed ? 1 : 0;
      const remotes = Array.from(remotePlayers.current.values(), (player: RemoteCar) => ({ player, ...remoteDrawState(player, alpha) }));

      remotes.forEach(({ player, x, y, angle, z }) => {
        drawCarV2(ctx, x, y, angle, player.color, { lights: remoteLightStrength(player), height: z });
      });

      drawExplosion();

      if (!isDestroyed) {
        drawCarV2(ctx, pose.x, pose.y, pose.angle, myColorRef.current, {
          steer: input.steer, braking: input.brake, lights: localLights, height: pose.z,
        });
      }

      // Headlights go on after the cars so they light up any bodywork they hit,
      // with shadows cut out behind every car in a beam. Cars whose beams
      // cannot reach the screen are skipped, and so is the layer if none can.
      const cars = [
        ...remotes.map(({ player, x, y, angle }) => ({
          id: player.id, x, y, angle, strength: remoteLightStrength(player) * 0.9,
        })),
        ...(isDestroyed ? [] : [{ id: myIdRef.current ?? 'local', ...pose, strength: localLights }]),
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
      remotes.forEach(({ player, x, y }) => {
        drawDriverTag(ctx, x, y, player.initials, player.color);
      });

      ctx.restore();

      drawConfetti();

      const minimap = minimapRef.current;
      if (minimap && !isStunt) {
        drawMinimap(
          minimap,
          { ...pose, color: myColorRef.current },
          remotes.map(({ player, x, y }) => ({ x, y, color: player.color })),
          ghostPose,
        );
      }
    };

    const drawExplosion = () => {
      for (const particle of explosionParticles.current) {
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
      for (const particle of confettiParticles.current) {
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

    /** Ramps whose cells touch the view, padded so a ramp's lip and shadow never pop in. */
    const visibleRamps = (left: number, top: number, right: number, bottom: number): Ramp[] =>
      rampsInRect(left - 300, top - 300, right + 300, bottom + 300);

    /** The Stunt Park lot in the original flat style. */
    const drawClassicLot = (left: number, top: number, right: number, bottom: number) => {
      ctx.fillStyle = '#333';
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let row = Math.floor(top / 700) * 700; row < bottom; row += 700) {
        ctx.moveTo(left, row + 200);
        ctx.lineTo(right, row + 200);
        for (let x = Math.floor(left / 110) * 110; x < right; x += 110) {
          ctx.moveTo(x, row);
          ctx.lineTo(x, row + 400);
        }
      }
      ctx.stroke();

      for (const ramp of visibleRamps(left, top, right, bottom)) {
        if (ramp.kind === 'bump') {
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(ramp.x, ramp.y, ramp.halfWidth, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 6;
          ctx.stroke();
          continue;
        }
        ctx.save();
        ctx.translate(ramp.x, ramp.y);
        ctx.rotate(ramp.angle);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(-ramp.halfLength, -ramp.halfWidth, ramp.halfLength * 2, ramp.halfWidth * 2);
        ctx.fillStyle = '#000';
        ctx.fillRect(ramp.halfLength - 16, -ramp.halfWidth, 16, ramp.halfWidth * 2);
        ctx.restore();
      }
    };

    /** The original car, lifted off its shadow and drawn larger when it is in the air. */
    const drawClassicCar = (x: number, y: number, angle: number, color: string, lights: boolean, z = 0) => {
      if (z <= 0) {
        drawCar(ctx, x, y, angle, color, lights);
        return;
      }
      ctx.save();
      ctx.translate(x + z * 0.55, y + z * 0.75);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.roundRect(-24, -14, 48, 28, 6);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(x, y);
      const scale = heightScale(z);
      ctx.scale(scale, scale);
      drawCar(ctx, 0, 0, angle, color, lights);
      ctx.restore();
    };

    // V1 is the original look: no ghost car and no sound
    const renderClassic = (isDestroyed: boolean, pose: Pose, alpha: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      if (isStunt) {
        ctx.save();
        ctx.translate(cameraX, cameraY);
        drawClassicLot(-cameraX, -cameraY, -cameraX + viewWidth, -cameraY + viewHeight);
        skidMarks.current.forEach(mark => {
          ctx.fillStyle = `rgba(0, 0, 0, ${mark.life * 0.4})`;
          ctx.beginPath();
          ctx.arc(mark.x, mark.y, 5, 0, Math.PI * 2);
          ctx.fill();
        });
        remotePlayers.current.forEach(p => {
          const { x, y, angle, z } = remoteDrawState(p, alpha);
          drawClassicCar(x, y, angle, p.color, false, z);
          drawDriverTag(ctx, x, y, p.initials, p.color);
        });
        if (!isDestroyed) {
          drawClassicCar(pose.x, pose.y, pose.angle, myColorRef.current, headlightsOnRef.current, pose.z);
        }
        ctx.restore();
        return;
      }

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
        const { x, y, angle } = remoteDrawState(p, alpha);
        drawCar(ctx, x, y, angle, p.color, false);
        drawDriverTag(ctx, x, y, p.initials, p.color);
      });

      // Local Car
      drawExplosion();

      if (!isDestroyed) {
        drawCar(ctx, pose.x, pose.y, pose.angle, myColorRef.current, headlightsOnRef.current);
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
      window.removeEventListener('blur', clearHeldKeys);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [playerInitials, level]);

  const handleJoin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextInitials = normalizeInitials(initialsInput);
    if (nextInitials.length === 0) {
      return;
    }

    // Submitting the form is a user gesture, which browsers require before audio can play
    sound.unlock();
    setPlayerInitials(nextInitials);
  };

  const handleResetLeaderboard = async () => {
    if (isResettingLeaderboard || !adminToken) {
      return;
    }

    const confirmed = window.confirm('Reset today\'s leaderboard records only? All-time scores will stay.');
    if (!confirmed) {
      return;
    }

    setIsResettingLeaderboard(true);
    try {
      setLeaderboard(await resetLeaderboard(clientTimeZone.current, adminToken));
      setLeaderboardStatus('ready');
      setLapCelebrationMessage(null);
      multiplayerRef.current?.broadcastLeaderboard();
    } catch (error) {
      console.error(error);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        forgetAdminToken();
        setAdminToken(null);
        window.alert(`Reset refused: ${error.message}`);
      } else {
        setLeaderboardStatus('error');
      }
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

  // Press-and-hold handlers for an on-screen control that stands in for a key.
  // Sliding off the button, or the system cancelling the touch, lets go.
  const holdKey = (key: string) => {
    const set = (down: boolean) => (event: React.PointerEvent) => {
      event.preventDefault();
      heldKeys.current[key] = down;
    };
    return {
      onPointerDown: set(true),
      onPointerUp: set(false),
      onPointerLeave: set(false),
      onPointerCancel: set(false),
    };
  };
  const controlButtonClass = 'bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white active:bg-white/30 select-none touch-none';
  // Gas, brake and steering buttons are for touch; mouse-and-keyboard players drive with keys
  const touchOnlyClass = '[@media(pointer:fine)]:hidden';

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
  const isStunt = level === 'stunt';
  const compactHud = (
    <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/10 bg-black/70 px-3 py-3 text-white shadow-xl backdrop-blur-md">
      {hudToggleButton}

      {isStunt ? (
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/45">
            Stunt Park
          </div>
          <div className="mt-1 font-mono text-lg font-bold text-yellow-400">
            {stuntStats.jumps} {stuntStats.jumps === 1 ? 'jump' : 'jumps'}
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/45">
            Lap {lap}
          </div>
          <div className="mt-1 flex items-center gap-2 font-mono">
            <span className="text-lg font-bold text-yellow-400">{currentLapDisplay}</span>
            {currentLapMedalBadge}
          </div>
        </div>
      )}
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

  const levelToggle = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <span id="level-label" className="text-xs uppercase tracking-widest text-gray-400">Level</span>
      <div
        aria-labelledby="level-label"
        className="pointer-events-auto relative grid w-36 grid-cols-2 rounded-full border border-white/10 bg-white/5 p-1"
        role="radiogroup"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 shadow-lg transition-transform duration-300 ease-out"
          style={{ transform: isStunt ? 'translateX(100%)' : 'translateX(0)' }}
        />
        {LEVELS.map(({ id, name }) => (
          <button
            aria-checked={level === id}
            className={`relative z-10 rounded-full py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition-colors ${
              level === id ? 'text-white' : 'text-white/50 hover:text-white/80'
            }`}
            key={id}
            onClick={() => setLevel(id)}
            role="radio"
            type="button"
          >
            {id === 'stunt' ? 'Stunt' : name}
          </button>
        ))}
      </div>
    </div>
  );

  const renderStatRow = (label: string, value: string | null, colorClass: string) => (
    <div className="flex items-center justify-between gap-4 sm:gap-6">
      <span className="text-xs uppercase tracking-widest text-gray-400">{label}</span>
      <span className={`text-base font-bold sm:text-lg ${value === null ? 'text-white/30' : colorClass}`}>
        {value ?? '--'}
      </span>
    </div>
  );
  const formatAir = (ms: number | null) => (ms === null ? null : `${(ms / 1000).toFixed(1)}s`);

  const stuntDetails = (
    <div className="space-y-2 font-mono">
      <div className="flex items-center justify-between gap-4 sm:gap-6">
        <span className="text-xs uppercase tracking-widest text-gray-400">Jumps</span>
        <span className="text-lg font-bold text-yellow-400 sm:text-xl">{stuntStats.jumps}</span>
      </div>
      {renderStatRow('Last air', formatAir(stuntStats.lastAirMs), 'text-cyan-100')}
      {renderStatRow('Best air', formatAir(stuntStats.bestAirMs), 'text-green-400')}
      {renderStatRow('Best spin', stuntStats.bestSpinDeg ? `${stuntStats.bestSpinDeg}°` : null, 'text-orange-300')}
      <p className="border-t border-white/10 pt-3 font-sans text-xs leading-relaxed text-gray-400">
        Hit the ramps with speed. Steer in the air to spin.
      </p>
    </div>
  );

  const soundToggle = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-widest text-gray-400">Sound</span>
      <button
        aria-label={muted ? 'Turn sound on (M)' : 'Turn sound off (M)'}
        aria-pressed={!muted}
        className={`pointer-events-auto flex w-28 items-center justify-center gap-2 rounded-full border py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
          muted ? 'border-white/10 bg-white/5 text-white/50 hover:text-white/80' : 'border-orange-300/30 bg-orange-400/15 text-orange-100'
        }`}
        onClick={() => {
          sound.unlock();
          toggleMute();
        }}
        title="Sound (M)"
        type="button"
      >
        <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          {muted ? (
            <>
              <path d="m22 9-6 6" />
              <path d="m16 9 6 6" />
            </>
          ) : (
            <>
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M19 5a10 10 0 0 1 0 14" />
            </>
          )}
        </svg>
        {muted ? 'Off' : 'On'}
      </button>
    </div>
  );

  const hudDetails = (
    <>
      <h1 className="mb-1 bg-gradient-to-r from-rose-400 to-orange-400 bg-clip-text text-xl font-black italic tracking-wider text-transparent sm:text-2xl">
        APEX RACER
      </h1>
      <p className="mb-4 text-xs font-medium text-gray-300 sm:text-sm">WASD or Arrows to drive, L for lights{isV2 && ', M for sound'}</p>
      {levelToggle}
      {graphicsToggle}
      {isV2 && soundToggle}

      {isStunt ? stuntDetails : (
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
            {adminToken && (
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
            )}
          </div>
          {renderLeaderboardList(leaderboard.today, 'today')}
          {leaderboardStatus === 'error' && (
            <p className="mt-2 text-xs text-rose-300">Leaderboard unavailable</p>
          )}
        </div>
      </div>
      )}
    </>
  );

  const lapFlashClass = lapFlash?.tone === 'trick'
    ? 'border-amber-200/40 bg-gradient-to-r from-orange-500/90 to-rose-500/90 text-lg uppercase italic tracking-wide'
    : lapFlash?.tone === 'ahead'
    ? 'border-emerald-200/40 bg-emerald-500/85 font-mono text-lg tabular-nums'
    : lapFlash?.tone === 'behind'
      ? 'border-rose-200/40 bg-rose-500/85 font-mono text-lg tabular-nums'
      : 'border-white/15 bg-slate-950/85 text-xs uppercase tracking-[0.3em] text-amber-200';

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
        {(isCompactHud || !isHudOpen) && compactHud}
        {isHudOpen && (isCompactHud ? (
          // Stops short of the driving controls at the bottom of the screen
          <div className="pointer-events-auto max-h-[min(28rem,calc(100dvh-13rem))] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl border border-white/10 bg-black/70 p-4 text-white shadow-2xl backdrop-blur-md">
            {hudDetails}
          </div>
        ) : (
          <div className="pointer-events-auto relative max-h-[calc(100dvh-3rem)] w-72 overflow-y-auto rounded-2xl border border-white/10 bg-black/60 p-5 pr-16 text-white shadow-xl backdrop-blur-md">
            <div className="absolute right-4 top-4">
              {hudToggleButton}
            </div>
            {hudDetails}
          </div>
        ))}
      </div>

      {/* Lap messages: below the top HUD on phones, at the top otherwise */}
      <div className="pointer-events-none absolute top-[36%] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2 px-4 sm:top-6">
        {lapCelebrationMessage && (
          <div className="animate-pulse whitespace-nowrap rounded-full border border-amber-200/40 bg-gradient-to-r from-amber-500/85 to-orange-500/85 px-5 py-3 text-center text-xs font-black uppercase tracking-[0.32em] text-white shadow-2xl backdrop-blur-md sm:text-sm">
            {lapCelebrationMessage}
          </div>
        )}
        {lapFlash && (
          <div
            aria-live="polite"
            className={`whitespace-nowrap rounded-full border px-4 py-2 text-center font-black text-white shadow-xl backdrop-blur-md ${lapFlashClass}`}
            key={lapFlash.id}
          >
            {lapFlash.text}
          </div>
        )}
      </div>

      {countdown && (
        // Above centre, so the car on the grid stays in view
        <div aria-live="assertive" className="pointer-events-none absolute inset-0 z-30 flex items-start justify-center pt-[18vh]">
          <span
            className={`countdown-pop text-8xl font-black italic tracking-tighter drop-shadow-[0_6px_24px_rgba(0,0,0,0.6)] sm:text-9xl ${
              countdown === 'GO!' ? 'text-emerald-300' : 'text-white'
            }`}
            key={countdown}
          >
            {countdown}
          </span>
        </div>
      )}

      {isV2 ? (
        <div className="pointer-events-none absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] flex flex-col items-end gap-3 sm:top-[max(1.5rem,env(safe-area-inset-top))] sm:right-[max(1.5rem,env(safe-area-inset-right))]">
          <SpeedGauge mph={speedMph} />
          {!isStunt && <canvas
            aria-label="Track map"
            // Height leaves room for the gauge above and the gas/headlight stack
            // below; width follows from the aspect ratio. Hidden on very short screens.
            className="h-[min(7.75rem,calc(100dvh-21rem))] w-auto rounded-2xl border border-white/10 bg-black/55 shadow-xl backdrop-blur-md sm:h-[min(11.75rem,calc(100dvh-24rem))] [@media(max-height:30rem)]:hidden"
            ref={minimapRef}
            role="img"
            style={{ aspectRatio: MINIMAP_ASPECT }}
          />}
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

      {/* On-screen Controls. The compact HUD panel's height is capped to stop above them. */}
      <div className={`absolute bottom-[max(2rem,env(safe-area-inset-bottom))] left-[max(2rem,env(safe-area-inset-left))] flex gap-4 ${touchOnlyClass}`}>
        <button aria-label="Steer left" className={`h-16 w-16 ${controlButtonClass}`} type="button" {...holdKey('TouchLeft')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <button aria-label="Steer right" className={`h-16 w-16 ${controlButtonClass}`} type="button" {...holdKey('TouchRight')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>

      <div className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] right-[max(2rem,env(safe-area-inset-right))] flex gap-4 items-end [@media(max-height:30rem)]:bottom-[max(1rem,env(safe-area-inset-bottom))]">
        <button className={`mb-2 h-16 w-16 ${controlButtonClass} ${touchOnlyClass}`} type="button" {...holdKey('TouchBrake')}>
          <span className="font-bold text-xs uppercase tracking-wider">Brake</span>
        </button>
        <div className="flex flex-col items-center gap-6 [@media(max-height:30rem)]:gap-3">
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
            className={`w-20 h-20 bg-rose-500/80 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white active:bg-rose-400 select-none touch-none ${touchOnlyClass}`}
            type="button"
            {...holdKey('TouchGas')}
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

            <fieldset className="mt-5">
              <legend className="text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Level</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {LEVELS.map(({ id, name, blurb }) => (
                  <button
                    aria-pressed={level === id}
                    className={`rounded-2xl border px-3 py-3 text-left transition ${
                      level === id
                        ? 'border-cyan-400 bg-cyan-400/10 text-white'
                        : 'border-white/10 bg-slate-900/60 text-slate-300 hover:border-white/25'
                    }`}
                    key={id}
                    onClick={() => setLevel(id)}
                    type="button"
                  >
                    <span className="block text-sm font-black italic">{name}</span>
                    <span className="mt-1 block text-[11px] leading-snug text-slate-400">{blurb}</span>
                  </button>
                ))}
              </div>
            </fieldset>

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
