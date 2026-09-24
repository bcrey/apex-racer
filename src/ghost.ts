// Best-lap ghost: the car's position every physics step of a lap, saved per
// driver in this browser and replayed as a see-through car on later laps.
import { lerp, PHYSICS_HZ, STEP_MS } from './physics';

export type GhostLap = {
  /** Lap length in physics steps (fractional). */
  ticks: number;
  /** Steps from the lap start to each checkpoint. */
  splits: number[];
  /** Steps from the lap start to the first sample; samples follow one step apart. */
  offset: number;
  /** x, y, angle for each step. */
  samples: number[];
};

export type GhostRecording = { offset: number; samples: number[] };

const STORAGE_PREFIX = 'apex-racer:best-lap:';
const STORAGE_VERSION = 1;
/** Stop recording after three minutes; nobody's best lap is that slow for long. */
const MAX_SAMPLES = PHYSICS_HZ * 180 * 3;

export function startRecording(offset: number): GhostRecording {
  return { offset, samples: [] };
}

export function recordSample(recording: GhostRecording, x: number, y: number, angle: number) {
  if (recording.samples.length < MAX_SAMPLES) {
    recording.samples.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(angle * 1000) / 1000);
  }
}

/** The ghost's position `ticks` steps into the lap, or null once its lap is over. */
export function sampleGhost(ghost: GhostLap, ticks: number) {
  const count = ghost.samples.length / 3;
  if (count === 0 || ticks > ghost.ticks) return null;
  const index = Math.max(0, ticks - ghost.offset);
  if (index > count - 1) return null;
  const k = Math.floor(index);
  const next = Math.min(k + 1, count - 1);
  const t = index - k;
  const s = ghost.samples;
  return {
    x: lerp(s[k * 3], s[next * 3], t),
    y: lerp(s[k * 3 + 1], s[next * 3 + 1], t),
    angle: lerp(s[k * 3 + 2], s[next * 3 + 2], t),
  };
}

function isGhostLap(value: unknown): value is GhostLap {
  if (typeof value !== 'object' || value === null) return false;
  const lap = value as Record<string, unknown>;
  return (
    typeof lap.ticks === 'number' && lap.ticks > 0 &&
    typeof lap.offset === 'number' &&
    Array.isArray(lap.splits) && lap.splits.every((split) => typeof split === 'number') &&
    Array.isArray(lap.samples) && lap.samples.length % 3 === 0 && lap.samples.every((n) => typeof n === 'number')
  );
}

export function loadBestLap(initials: string): GhostLap | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + initials);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { v?: number; lap?: unknown };
    return stored.v === STORAGE_VERSION && isGhostLap(stored.lap) ? stored.lap : null;
  } catch {
    return null;
  }
}

export function saveBestLap(initials: string, lap: GhostLap) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + initials, JSON.stringify({ v: STORAGE_VERSION, lap }));
  } catch {
    // Private mode or full storage: the ghost lasts for this visit only
  }
}

export function ticksToMs(ticks: number) {
  return ticks * STEP_MS;
}

/** "+0.34" when behind, "−0.12" when ahead (a real minus sign). */
export function formatGap(ms: number) {
  const seconds = Math.abs(ms) / 1000;
  return `${ms > 0 ? '+' : ms < 0 ? '−' : '±'}${seconds.toFixed(2)}`;
}
