// Other players' cars. Network updates arrive about 20 times a second; between
// them the car coasts on its last known velocity, and when a new update lands
// the drawn car eases onto it instead of jumping.
import { lerp } from './physics';

/** `z` is height in the air (Stunt Park jumps); absent means on the ground. */
export type NetworkCarState = { x: number; y: number; angle: number; vx: number; vy: number; z?: number };

export type RemoteCar = {
  id: string;
  initials: string;
  color: string;
  lights?: boolean;
  /** Drawn state after the latest physics step. */
  x: number;
  y: number;
  angle: number;
  /** Drawn state one step earlier, to draw between steps. */
  prevX: number;
  prevY: number;
  prevAngle: number;
  /** Latest network velocity, per physics step. */
  vx: number;
  vy: number;
  /** Latest network state, carried forward each step by its velocity. */
  netX: number;
  netY: number;
  netAngle: number;
  /** Height in the air, eased toward the latest network height. */
  z: number;
  prevZ: number;
  netZ: number;
};

/** Share of the gap to the network state closed each step: settles in about 80 ms. */
const CATCH_UP = 0.2;
/** Further off than this (a respawn, a long stall) and the car jumps straight there. */
const SNAP_DISTANCE = 400;

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function createRemoteCar(
  info: { id: string; initials: string; color: string; lights?: boolean } & NetworkCarState,
): RemoteCar {
  return {
    id: info.id,
    initials: info.initials,
    color: info.color,
    lights: info.lights,
    x: info.x,
    y: info.y,
    angle: info.angle,
    prevX: info.x,
    prevY: info.y,
    prevAngle: info.angle,
    vx: info.vx,
    vy: info.vy,
    netX: info.x,
    netY: info.y,
    netAngle: info.angle,
    z: info.z ?? 0,
    prevZ: info.z ?? 0,
    netZ: info.z ?? 0,
  };
}

export function applyNetworkState(car: RemoteCar, state: NetworkCarState & { lights?: boolean }) {
  car.netX = state.x;
  car.netY = state.y;
  car.netAngle = state.angle;
  car.vx = state.vx;
  car.vy = state.vy;
  car.lights = state.lights;
  car.netZ = state.z ?? 0;

  if (Math.hypot(car.x - state.x, car.y - state.y) > SNAP_DISTANCE) {
    car.x = car.prevX = state.x;
    car.y = car.prevY = state.y;
    car.angle = car.prevAngle = state.angle;
  }
}

/** One physics step: coast both states forward, then pull the drawn car toward the network one. */
export function stepRemoteCar(car: RemoteCar) {
  car.prevX = car.x;
  car.prevY = car.y;
  car.prevAngle = car.angle;
  car.prevZ = car.z;

  car.netX += car.vx;
  car.netY += car.vy;
  car.x += car.vx;
  car.y += car.vy;
  car.x += (car.netX - car.x) * CATCH_UP;
  car.y += (car.netY - car.y) * CATCH_UP;
  car.angle += wrapAngle(car.netAngle - car.angle) * CATCH_UP;
  car.z += (car.netZ - car.z) * 0.35;
}

/** Where to draw the car `alpha` of the way from its previous step to its latest. */
export function remoteDrawState(car: RemoteCar, alpha: number) {
  return {
    x: lerp(car.prevX, car.x, alpha),
    y: lerp(car.prevY, car.y, alpha),
    angle: lerp(car.prevAngle, car.angle, alpha),
    z: lerp(car.prevZ, car.z, alpha),
  };
}
