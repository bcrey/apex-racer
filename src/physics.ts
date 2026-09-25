// Car physics, run at a fixed rate so a 30 Hz phone and a 144 Hz monitor
// drive the same car. Every constant below is "per step" at PHYSICS_HZ.
import { HALF_TRACK_WIDTH, trackPoints, type Point } from './track';

export const PHYSICS_HZ = 60;
export const STEP_MS = 1000 / PHYSICS_HZ;
/** Longest stall the game catches up on (250 ms). Past that, time is dropped. */
export const MAX_STEPS_PER_FRAME = 15;

export type CarState = { x: number; y: number; vx: number; vy: number; angle: number };

/** `steer` is -1 (left), 0 or 1 (right). */
export type DriveInput = { gas: boolean; brake: boolean; steer: number };

export const NO_INPUT: DriveInput = { gas: false, brake: false, steer: 0 };

export type StepInfo = {
  /** Forward speed going into the step, in world units per step. */
  speed: number;
  lateralSpeed: number;
  isOnTrack: boolean;
  isDrifting: boolean;
  forwardX: number;
  forwardY: number;
  rightX: number;
  rightY: number;
};

function sqr(x: number) {
  return x * x;
}

export function dist2(v: Point, w: Point) {
  return sqr(v.x - w.x) + sqr(v.y - w.y);
}

function distToSegmentSquared(p: Point, v: Point, w: Point) {
  const l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

export function getDistanceToTrack(p: Point) {
  let minDistSq = Infinity;
  for (let i = 0; i < trackPoints.length - 1; i++) {
    const d2 = distToSegmentSquared(p, trackPoints[i], trackPoints[i + 1]);
    if (d2 < minDistSq) minDistSq = d2;
  }
  return Math.sqrt(minDistSq);
}

/** True where the car has full grip: the circuit's tarmac, by default. */
export type SurfaceTest = (p: Point) => boolean;

export const isOnCircuit: SurfaceTest = (p) => getDistanceToTrack(p) < HALF_TRACK_WIDTH;

/** Advances the car by one physics step. */
export function stepCar(c: CarState, input: DriveInput, isOnSurface: SurfaceTest = isOnCircuit): StepInfo {
  const steer = Math.sign(input.steer);
  const forwardX = Math.cos(c.angle);
  const forwardY = Math.sin(c.angle);
  const rightX = Math.cos(c.angle + Math.PI / 2);
  const rightY = Math.sin(c.angle + Math.PI / 2);

  const speed = c.vx * forwardX + c.vy * forwardY;
  const lateralSpeed = c.vx * rightX + c.vy * rightY;

  const isOnTrack = isOnSurface(c);
  const isDrifting = isOnTrack && input.brake && steer !== 0 && Math.abs(speed) > 2.5;

  const engineForce = isOnTrack ? 0.6 : 0.3;
  const brakingForce = isOnTrack ? (isDrifting ? 0.22 : 0.8) : 0.4;
  const turnSpeed = isDrifting ? 0.072 : 0.05;
  const drag = isOnTrack ? (isDrifting ? 0.985 : 0.97) : 0.9;
  const grip = isOnTrack ? (isDrifting ? 0.045 : 0.15) : 0.05;

  if (input.gas) {
    c.vx += forwardX * engineForce;
    c.vy += forwardY * engineForce;
  }
  if (input.brake) {
    const brakeAmount = Math.min(Math.abs(speed), brakingForce);
    const brakeDirection = speed === 0 ? 0 : Math.sign(speed);
    c.vx -= forwardX * brakeAmount * brakeDirection;
    c.vy -= forwardY * brakeAmount * brakeDirection;
  }

  if (Math.abs(speed) > 0.5) {
    c.angle += turnSpeed * (speed > 0 ? 1 : -1) * steer;
  }

  if (isDrifting) {
    const driftPush = Math.min(Math.abs(speed) * 0.03, 0.75);
    c.vx += rightX * steer * driftPush;
    c.vy += rightY * steer * driftPush;
  }

  // Lateral friction (grip)
  c.vx -= rightX * lateralSpeed * grip;
  c.vy -= rightY * lateralSpeed * grip;

  c.vx *= drag;
  c.vy *= drag;

  // Remove any backward motion so brake input acts like a drift brake, not reverse
  const nextForwardSpeed = c.vx * forwardX + c.vy * forwardY;
  if (nextForwardSpeed < 0) {
    c.vx -= forwardX * nextForwardSpeed;
    c.vy -= forwardY * nextForwardSpeed;
  }

  c.x += c.vx;
  c.y += c.vy;

  return { speed, lateralSpeed, isOnTrack, isDrifting, forwardX, forwardY, rightX, rightY };
}

export type FixedClock = { accumulator: number; lastTime: number | null };

export function createFixedClock(): FixedClock {
  return { accumulator: 0, lastTime: null };
}

/**
 * Works out how many physics steps a frame at `time` (ms) owes. `alpha` is how
 * far the frame sits between the last step and the next, for smooth drawing.
 * `dropped` means the frame came after a long stall (a hidden tab, a hang)
 * and the time beyond MAX_STEPS_PER_FRAME was thrown away.
 */
export function advanceClock(clock: FixedClock, time: number) {
  if (clock.lastTime === null) {
    clock.lastTime = time;
    return { steps: 0, alpha: 0, dropped: false };
  }

  clock.accumulator += Math.max(0, time - clock.lastTime);
  clock.lastTime = time;

  // The epsilon stops float error turning a whole step into 0.99999 of one
  let steps = Math.floor(clock.accumulator / STEP_MS + 1e-6);
  let dropped = false;
  if (steps > MAX_STEPS_PER_FRAME) {
    steps = MAX_STEPS_PER_FRAME;
    clock.accumulator = 0;
    dropped = true;
  } else {
    clock.accumulator = Math.max(0, clock.accumulator - steps * STEP_MS);
  }

  return { steps, alpha: Math.min(1, clock.accumulator / STEP_MS), dropped };
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Per-step easing factor `k` rescaled for a frame that lasted `dtMs`. */
export function easeForFrame(k: number, dtMs: number) {
  return 1 - Math.pow(1 - k, dtMs / STEP_MS);
}
