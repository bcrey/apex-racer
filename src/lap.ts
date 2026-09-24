// Lap timing in physics steps. A lap starts the first time the car crosses the
// start/finish line, needs every checkpoint in order, and ends at the next
// crossing. Crossings are placed between steps, so times are not rounded to
// a whole step.
import { dist2 } from './physics';
import { HALF_TRACK_WIDTH, START_FINISH_X, START_FINISH_Y, type Point } from './track';

// Anti-cheat checkpoints; they also give the split times
export const CHECKPOINTS: readonly Point[] = [
  { x: 2000, y: 1500 },
  { x: 1500, y: 2500 },
  { x: -1000, y: 1000 },
];
export const CHECKPOINT_RADIUS = 400;

export type LapState = {
  /** False until the car first crosses the line; the clock is not running yet. */
  running: boolean;
  /** Step count (fractional) at which the current lap began. */
  startTick: number;
  nextCheckpoint: number;
  /** Steps from the lap start to each checkpoint reached so far. */
  splits: number[];
  /** Set when the game dropped time mid-lap, so the lap cannot be trusted. */
  interrupted: boolean;
};

export type LapEvent =
  | { type: 'start'; tick: number }
  | { type: 'checkpoint'; index: number; ticks: number }
  | { type: 'finish'; ticks: number; splits: number[]; interrupted: boolean; tick: number };

export function createLapState(): LapState {
  return { running: false, startTick: 0, nextCheckpoint: 0, splits: [], interrupted: false };
}

/** Fraction of the move from `prev` to `cur` at which the car crosses the line going forward, or null. */
export function lineCrossing(prev: Point, cur: Point) {
  if (!(prev.x < START_FINISH_X && cur.x >= START_FINISH_X)) {
    return null;
  }
  const t = (START_FINISH_X - prev.x) / (cur.x - prev.x);
  const y = prev.y + (cur.y - prev.y) * t;
  return Math.abs(y - START_FINISH_Y) < HALF_TRACK_WIDTH ? t : null;
}

/**
 * Updates the lap after the physics step that moved the car from `prev` to
 * `cur` and brought the step count to `tick`.
 */
export function updateLap(state: LapState, prev: Point, cur: Point, tick: number): LapEvent | null {
  const crossing = lineCrossing(prev, cur);
  const crossingTick = crossing === null ? null : tick - 1 + crossing;

  if (!state.running) {
    if (crossingTick === null) return null;
    Object.assign(state, createLapState(), { running: true, startTick: crossingTick });
    return { type: 'start', tick: crossingTick };
  }

  if (state.nextCheckpoint < CHECKPOINTS.length) {
    if (dist2(cur, CHECKPOINTS[state.nextCheckpoint]) < CHECKPOINT_RADIUS * CHECKPOINT_RADIUS) {
      const ticks = tick - state.startTick;
      state.splits.push(ticks);
      state.nextCheckpoint++;
      return { type: 'checkpoint', index: state.nextCheckpoint - 1, ticks };
    }
    return null;
  }

  if (crossingTick === null) return null;
  const event: LapEvent = {
    type: 'finish',
    ticks: crossingTick - state.startTick,
    splits: state.splits,
    interrupted: state.interrupted,
    tick: crossingTick,
  };
  Object.assign(state, createLapState(), { running: true, startTick: crossingTick });
  return event;
}
