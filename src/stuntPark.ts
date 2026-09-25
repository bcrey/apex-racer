// Stunt Park: an endless parking lot scattered with jumps. Ramps come from a
// hash of each grid cell, so the lot is the same wherever you drive, new jumps
// keep appearing ahead, and nothing needs storing or syncing.
import { stepCar, type CarState, type DriveInput, type StepInfo } from './physics';
import { getGridSlotPosition, type Point } from './track';

export type Ramp = {
  id: string;
  /** A kicker launches hardest when hit head-on; a bump is a round hump that hops you from any side. */
  kind: 'kicker' | 'bump';
  x: number;
  y: number;
  /** Direction a kicker launches you. */
  angle: number;
  /** Half the size across the direction of travel (the easy-to-hit width). */
  halfWidth: number;
  /** Half the size along the direction of travel. For a bump, both are its radius. */
  halfLength: number;
};

export const STUNT_CELL = 620;
/** No jumps this close to the starting grid, so everyone can get rolling first. */
const SPAWN_CLEAR_RADIUS = 700;
const SPAWN = getGridSlotPosition(0);

export const AIR_GRAVITY = 0.45;
const MAX_LAUNCH = 14;
const MIN_LAUNCH_SPEED = 2;
/** Touching down faster than this bounces the car back up a little. */
const BOUNCE_IMPACT = 4;
const BOUNCE_KEEP = 0.3;
const AIR_SPIN_RATE = 0.06;
const AIR_DRAG = 0.995;

/** Deterministic 0..1 value for a cell and a salt. */
function cellRandom(i: number, j: number, salt: number) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(salt + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const cellCache = new Map<string, Ramp[]>();

export function rampsInCell(i: number, j: number): Ramp[] {
  const key = `${i},${j}`;
  const cached = cellCache.get(key);
  if (cached) return cached;

  const ramps: Ramp[] = [];
  const roll = cellRandom(i, j, 0);
  const margin = STUNT_CELL * 0.32;
  const x = i * STUNT_CELL + margin + cellRandom(i, j, 1) * (STUNT_CELL - margin * 2);
  const y = j * STUNT_CELL + margin + cellRandom(i, j, 2) * (STUNT_CELL - margin * 2);
  const nearSpawn = Math.hypot(x - SPAWN.x, y - SPAWN.y) < SPAWN_CLEAR_RADIUS;

  if (!nearSpawn && roll < 0.92) {
    if (roll < 0.62) {
      // Kickers line up with the lot's rows, in one of eight directions
      ramps.push({
        id: key,
        kind: 'kicker',
        x,
        y,
        angle: Math.floor(cellRandom(i, j, 3) * 8) * (Math.PI / 4),
        halfWidth: 210 + cellRandom(i, j, 4) * 60,
        halfLength: 75,
      });
    } else {
      const radius = 95 + cellRandom(i, j, 4) * 40;
      ramps.push({ id: key, kind: 'bump', x, y, angle: 0, halfWidth: radius, halfLength: radius });
    }
  }

  // The lot is endless; forget far-off cells rather than grow forever
  if (cellCache.size > 4000) cellCache.clear();
  cellCache.set(key, ramps);
  return ramps;
}

function rampsInRectCells(i0: number, j0: number, i1: number, j1: number): Ramp[] {
  const ramps: Ramp[] = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      ramps.push(...rampsInCell(i, j));
    }
  }
  return ramps;
}

/** Every ramp in cells overlapping the rectangle. */
export function rampsInRect(left: number, top: number, right: number, bottom: number): Ramp[] {
  return rampsInRectCells(
    Math.floor(left / STUNT_CELL),
    Math.floor(top / STUNT_CELL),
    Math.floor(right / STUNT_CELL),
    Math.floor(bottom / STUNT_CELL),
  );
}

/** The ramp under a point, if any. */
export function rampAt(p: Point): Ramp | null {
  // Wide kickers can overhang into the next cell, so look at the neighbours too
  const ci = Math.floor(p.x / STUNT_CELL);
  const cj = Math.floor(p.y / STUNT_CELL);
  for (const ramp of rampsInRectCells(ci - 1, cj - 1, ci + 1, cj + 1)) {
    const dx = p.x - ramp.x;
    const dy = p.y - ramp.y;
    if (ramp.kind === 'bump') {
      if (dx * dx + dy * dy <= ramp.halfWidth * ramp.halfWidth) return ramp;
      continue;
    }
    const along = dx * Math.cos(ramp.angle) + dy * Math.sin(ramp.angle);
    const across = -dx * Math.sin(ramp.angle) + dy * Math.cos(ramp.angle);
    if (Math.abs(along) <= ramp.halfLength && Math.abs(across) <= ramp.halfWidth) return ramp;
  }
  return null;
}

export type AirState = {
  /** Height above the lot. */
  z: number;
  vz: number;
  /** Steps since takeoff. */
  airTicks: number;
  /** Rotation picked up in the air, in radians. */
  spin: number;
  /** True for the small hop after a hard landing, which is not a new jump. */
  bouncing: boolean;
  /** The ramp the car is on, so staying on it does not launch again. */
  rampId: string | null;
};

export type StuntEvent =
  | { type: 'launch'; ramp: Ramp }
  | { type: 'land'; airTicks: number; spin: number; impact: number };

export function createAirState(): AirState {
  return { z: 0, vz: 0, airTicks: 0, spin: 0, bouncing: false, rampId: null };
}

export function isAirborne(air: AirState) {
  return air.z > 0;
}

const everywhereIsLot = () => true;

/**
 * One physics step in Stunt Park. On the ground the car drives as usual on
 * all-tarmac; hitting a ramp with some speed throws it into the air, where it
 * keeps its momentum, can spin with the steering, and falls back down.
 */
export function stepStuntCar(c: CarState, air: AirState, input: DriveInput): { step: StepInfo; event: StuntEvent | null } {
  if (isAirborne(air)) {
    const steer = Math.sign(input.steer);
    c.angle += AIR_SPIN_RATE * steer;
    if (!air.bouncing) air.spin += AIR_SPIN_RATE * steer;

    c.x += c.vx;
    c.y += c.vy;
    c.vx *= AIR_DRAG;
    c.vy *= AIR_DRAG;
    air.vz -= AIR_GRAVITY;
    air.z += air.vz;
    air.airTicks++;

    let event: StuntEvent | null = null;
    if (air.z <= 0) {
      const impact = -air.vz;
      if (!air.bouncing) {
        event = { type: 'land', airTicks: air.airTicks, spin: air.spin, impact };
      }
      if (impact > BOUNCE_IMPACT && !air.bouncing) {
        air.z = 0.01;
        air.vz = impact * BOUNCE_KEEP;
        air.bouncing = true;
      } else {
        air.z = 0;
        air.vz = 0;
        air.bouncing = false;
      }
    }

    const forwardX = Math.cos(c.angle);
    const forwardY = Math.sin(c.angle);
    return {
      step: {
        speed: c.vx * forwardX + c.vy * forwardY,
        lateralSpeed: -c.vx * forwardY + c.vy * forwardX,
        isOnTrack: true,
        isDrifting: false,
        forwardX,
        forwardY,
        rightX: -forwardY,
        rightY: forwardX,
      },
      event,
    };
  }

  const step = stepCar(c, input, everywhereIsLot);
  const ramp = rampAt(c);
  let event: StuntEvent | null = null;
  const speed = Math.hypot(c.vx, c.vy);

  if (ramp && ramp.id !== air.rampId && speed > MIN_LAUNCH_SPEED) {
    let lift: number;
    if (ramp.kind === 'kicker') {
      // Head-on sends you highest; clipping it sideways still gives a hop
      const facing = (c.vx * Math.cos(ramp.angle) + c.vy * Math.sin(ramp.angle)) / speed;
      lift = 0.3 + 0.4 * Math.max(0, facing);
    } else {
      lift = 0.28;
    }
    air.vz = Math.min(MAX_LAUNCH, speed * lift + 2);
    air.z = 0.01;
    air.airTicks = 0;
    air.spin = 0;
    air.bouncing = false;
    event = { type: 'launch', ramp };
  }
  air.rampId = ramp?.id ?? null;

  return { step, event };
}

/** How much bigger to draw a car at height `z`, as if it were closer to the camera. */
export function heightScale(z: number) {
  return 1 + z / 380;
}
