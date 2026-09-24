// "V2" renderer. The classic look stays in App.tsx untouched; everything here
// draws in world coordinates unless the function name says otherwise.
import {
  HALF_TRACK_WIDTH,
  START_FINISH_X,
  START_FINISH_Y,
  STARTING_GRID_OFFSET,
  TRACK_WIDTH,
  trackPoints,
  type Point,
} from './track';

export type GraphicsMode = 'classic' | 'v2';

export type SkidMark = { x: number; y: number; life: number; side: 0 | 1; streak: number; surface?: 'grass' };

// Clippings and clods kicked up by the rear wheels off track. `z` is height
// above the ground, so a bit arcs up, falls, and lies on the grass to fade.
export type GrassParticle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotation: number;
  spin: number;
  life: number;
  length: number;
  color: string;
  clod: boolean;
};

export type SmokeParticle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number };

export type MinimapCar = { x: number; y: number; color: string };

// Base zoom, easing out a little as speed rises so you can see further ahead.
export const V2_ZOOM = 1.5;
export const V2_ZOOM_AT_SPEED = 1.15;

/** Small screens zoom out so the road ahead stays in view. */
export function getViewportZoomScale(width: number, height: number) {
  return Math.min(1, Math.max(0.55, Math.min(width, height) / 820));
}

export const V2_TOP_SPEED = 19;

const GRASS_LIGHT = '#1d8243';
const GRASS_DARK = '#18733a';
const GRASS_TUFT = '#135f2f';
const GRASS_STRIPE = 180;
const KERB_WIDTH = 22;
const EDGE_INSET = 14;

let asphaltPattern: CanvasPattern | null = null;

function getAsphaltPattern(ctx: CanvasRenderingContext2D) {
  if (asphaltPattern) return asphaltPattern;

  const tile = document.createElement('canvas');
  tile.width = 256;
  tile.height = 256;
  const t = tile.getContext('2d')!;
  t.fillStyle = '#34363c';
  t.fillRect(0, 0, 256, 256);

  // Deterministic speckle so the surface does not shimmer between reloads
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 2600; i++) {
    const light = rand() > 0.5;
    t.fillStyle = light ? `rgba(255,255,255,${0.03 + rand() * 0.05})` : `rgba(0,0,0,${0.08 + rand() * 0.12})`;
    const size = 1 + rand() * 2.5;
    t.fillRect(rand() * 256, rand() * 256, size, size);
  }

  asphaltPattern = ctx.createPattern(tile, 'repeat');
  return asphaltPattern;
}

function traceTrack(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(trackPoints[0].x, trackPoints[0].y);
  for (let i = 1; i < trackPoints.length; i++) {
    ctx.lineTo(trackPoints[i].x, trackPoints[i].y);
  }
}

/** Mowed grass stripes and tufts covering the visible world rectangle. */
export function drawGrassV2(ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number) {
  const first = Math.floor(left / GRASS_STRIPE);
  for (let i = first; i * GRASS_STRIPE < right; i++) {
    ctx.fillStyle = i % 2 === 0 ? GRASS_LIGHT : GRASS_DARK;
    ctx.fillRect(i * GRASS_STRIPE, top, GRASS_STRIPE, bottom - top);
  }

  ctx.fillStyle = GRASS_TUFT;
  const spacing = 110;
  for (let x = Math.floor(left / spacing) * spacing; x < right + spacing; x += spacing) {
    for (let y = Math.floor(top / spacing) * spacing; y < bottom + spacing; y += spacing) {
      const ox = Math.sin(x * 12.345 + y * 67.89) * 40;
      const oy = Math.cos(x * 98.76 + y * 54.321) * 40;
      ctx.beginPath();
      ctx.ellipse(x + ox, y + oy, 7, 4, (x + y) * 0.01, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Kerbs, textured asphalt, edge lines, start/finish and grid boxes. */
export function drawTrackV2(ctx: CanvasRenderingContext2D) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Worn verge
  traceTrack(ctx);
  ctx.lineWidth = TRACK_WIDTH + KERB_WIDTH * 2 + 50;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)';
  ctx.stroke();

  // Red and white kerbs
  ctx.lineWidth = TRACK_WIDTH + KERB_WIDTH * 2;
  ctx.strokeStyle = '#dc2626';
  ctx.stroke();
  // Butt caps, or each dash's round cap would paint over the gaps
  ctx.lineCap = 'butt';
  ctx.setLineDash([40, 40]);
  ctx.strokeStyle = '#f1f5f9';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'round';

  // Asphalt, then white edge lines painted just inside the kerbs
  ctx.lineWidth = TRACK_WIDTH;
  ctx.strokeStyle = getAsphaltPattern(ctx) ?? '#34363c';
  ctx.stroke();
  ctx.lineWidth = TRACK_WIDTH - EDGE_INSET * 2;
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
  ctx.stroke();
  ctx.lineWidth = TRACK_WIDTH - EDGE_INSET * 2 - 12;
  ctx.strokeStyle = getAsphaltPattern(ctx) ?? '#34363c';
  ctx.stroke();

  // Start/finish: three-column checker across the track
  const square = 16;
  const half = HALF_TRACK_WIDTH - EDGE_INSET - 6;
  ctx.save();
  ctx.translate(START_FINISH_X, START_FINISH_Y);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row * square < half * 2; row++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#f8fafc' : '#0f172a';
      ctx.fillRect(-square * 1.5 + col * square, -half + row * square, square, Math.min(square, half * 2 - row * square));
    }
  }
  ctx.restore();

  // Painted grid boxes behind the line (matches getGridPlacement in App.tsx)
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.7)';
  ctx.lineWidth = 4;
  for (let slot = 0; slot < 6; slot++) {
    const x = START_FINISH_X - STARTING_GRID_OFFSET - Math.floor(slot / 2) * 120;
    const y = slot % 2 === 0 ? -80 : 80;
    ctx.beginPath();
    ctx.moveTo(x + 30, y - 22);
    ctx.lineTo(x + 38, y - 22);
    ctx.lineTo(x + 38, y + 22);
    ctx.lineTo(x + 30, y + 22);
    ctx.stroke();
  }
}

/** Continuous rubber lines (or churned ruts on grass) instead of dotted circles. */
export function drawSkidMarksV2(ctx: CanvasRenderingContext2D, marks: SkidMark[]) {
  ctx.lineCap = 'round';
  const last: (SkidMark | undefined)[] = [undefined, undefined];
  for (const mark of marks) {
    const prev = last[mark.side];
    if (prev && prev.streak === mark.streak) {
      const grass = mark.surface === 'grass';
      ctx.lineWidth = grass ? 7 : 6;
      ctx.strokeStyle = grass ? `rgba(20, 58, 24, ${mark.life * 0.4})` : `rgba(10, 10, 12, ${mark.life * 0.45})`;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(mark.x, mark.y);
      ctx.stroke();
    }
    last[mark.side] = mark;
  }
}

export function spawnSmoke(particles: SmokeParticle[], x: number, y: number, vx: number, vy: number) {
  if (particles.length > 160) return;
  const maxLife = 34 + Math.random() * 20;
  particles.push({
    x: x + (Math.random() - 0.5) * 8,
    y: y + (Math.random() - 0.5) * 8,
    vx: vx * 0.25 + (Math.random() - 0.5) * 0.8,
    vy: vy * 0.25 + (Math.random() - 0.5) * 0.8,
    life: maxLife,
    maxLife,
    size: 8 + Math.random() * 6,
  });
}

export function updateAndDrawSmoke(ctx: CanvasRenderingContext2D, particles: SmokeParticle[]) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life -= 1;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    const age = 1 - p.life / p.maxLife;
    const radius = p.size * (1 + age * 2.2);
    const puff = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    puff.addColorStop(0, `rgba(226, 232, 240, ${(1 - age) * 0.22})`);
    puff.addColorStop(1, 'rgba(226, 232, 240, 0)');
    ctx.fillStyle = puff;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

const GRASS_BITS = ['#4ade80', '#22c55e', '#16a34a', '#86efac', '#15803d'];
const DIRT_BITS = ['#78350f', '#92400e', '#57301a'];
const GRASS_GRAVITY = 0.28;

/** Throws clippings back and out from a rear wheel. `speed` is the car's ground speed. */
export function spawnGrass(
  particles: GrassParticle[],
  x: number,
  y: number,
  carVx: number,
  carVy: number,
  forwardX: number,
  forwardY: number,
  speed: number,
) {
  if (particles.length > 260) return;
  const count = Math.min(4, Math.ceil(speed / 4));
  for (let i = 0; i < count; i++) {
    const clod = Math.random() < 0.18;
    const kick = 1 + Math.random() * 2.5;
    const spread = (Math.random() - 0.5) * 3;
    particles.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      z: 2,
      vx: carVx * 0.35 - forwardX * kick - forwardY * spread,
      vy: carVy * 0.35 - forwardY * kick + forwardX * spread,
      vz: 2 + Math.random() * (1.5 + speed * 0.12),
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.6,
      life: 50 + Math.random() * 30,
      length: clod ? 0.625 + Math.random() * 0.5 : 2 + Math.random() * 2,
      color: clod
        ? DIRT_BITS[Math.floor(Math.random() * DIRT_BITS.length)]
        : GRASS_BITS[Math.floor(Math.random() * GRASS_BITS.length)],
      clod,
    });
  }
}

export function updateAndDrawGrass(ctx: CanvasRenderingContext2D, particles: GrassParticle[]) {
  ctx.lineCap = 'round';
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= 1;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    const airborne = p.z > 0 || p.vz > 0;
    if (airborne) {
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;
      p.vz -= GRASS_GRAVITY;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.rotation += p.spin;
      if (p.z <= 0) {
        p.z = 0;
        p.vz = 0;
      }
    }

    const alpha = Math.min(1, p.life / 20);

    // Shadow on the ground shrinks as the bit rises
    if (p.z > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.25 * alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.length * 0.4 - p.z * 0.025), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y - p.z);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    ctx.strokeStyle = p.color;
    if (p.clod) {
      ctx.beginPath();
      ctx.arc(0, 0, p.length, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-p.length / 2, 0);
      ctx.lineTo(p.length / 2, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Car painted in the driver's colour, with a light-source shadow, steering
 * front wheels and brake lights. Same 48x28 footprint as the classic car.
 */
export function drawCarV2(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string,
  options: { steer?: number; braking?: boolean; lights?: number } = {},
) {
  const steer = options.steer ?? 0;

  // Shadow is cast down and to the right no matter which way the car faces
  ctx.save();
  ctx.translate(x + 5, y + 7);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath();
  ctx.roundRect(-24, -14, 49, 28, 9);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Tyres (fronts turn with steering input)
  ctx.fillStyle = '#0b0f19';
  for (const [tx, ty, turn] of [[16, -12, true], [16, 12, true], [-10, -12, false], [-10, 12, false]] as const) {
    ctx.save();
    ctx.translate(tx, ty);
    if (turn) ctx.rotate(steer * 0.4);
    ctx.beginPath();
    ctx.roundRect(-6, -3, 12, 6, 2);
    ctx.fill();
    ctx.restore();
  }

  // Body with a top-lit gradient
  const body = ctx.createLinearGradient(0, -11, 0, 11);
  body.addColorStop(0, shade(color, 0.35));
  body.addColorStop(0.45, color);
  body.addColorStop(1, shade(color, -0.45));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-21, -11);
  ctx.lineTo(12, -11);
  ctx.quadraticCurveTo(24, -10, 24, 0);
  ctx.quadraticCurveTo(24, 10, 12, 11);
  ctx.lineTo(-21, 11);
  ctx.quadraticCurveTo(-23, 11, -23, 9);
  ctx.lineTo(-23, -9);
  ctx.quadraticCurveTo(-23, -11, -21, -11);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Twin racing stripes
  ctx.fillStyle = 'rgba(248, 250, 252, 0.9)';
  ctx.fillRect(-20, -3.5, 42, 2.5);
  ctx.fillRect(-20, 1, 42, 2.5);

  // Canopy with a glass highlight
  const glass = ctx.createLinearGradient(-8, -7, 10, 7);
  glass.addColorStop(0, '#1e3a5f');
  glass.addColorStop(0.5, '#0b1220');
  glass.addColorStop(1, '#020617');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.roundRect(-9, -7.5, 20, 15, 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(125, 211, 252, 0.55)';
  ctx.beginPath();
  ctx.moveTo(5, -6);
  ctx.lineTo(10.5, -4.5);
  ctx.lineTo(10.5, 4.5);
  ctx.lineTo(5, 6);
  ctx.closePath();
  ctx.fill();

  // Rear wing with colour-matched end plates
  ctx.fillStyle = '#0b1220';
  ctx.beginPath();
  ctx.roundRect(-26, -12, 5, 24, 1.5);
  ctx.fill();
  ctx.fillStyle = shade(color, -0.2);
  ctx.fillRect(-26, -13, 5, 3);
  ctx.fillRect(-26, 10, 5, 3);

  // Headlights, with a bloom around each lamp when they are on
  if (options.lights) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const ly of [-6.5, 6.5]) {
      const bloom = ctx.createRadialGradient(21, ly, 0, 21, ly, 9);
      bloom.addColorStop(0, `rgba(255, 244, 214, ${0.4 * options.lights})`);
      bloom.addColorStop(1, 'rgba(255, 244, 214, 0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(12, ly - 9, 18, 18);
    }
    ctx.restore();
  }
  ctx.fillStyle = options.lights ? '#fffbeb' : '#fef9c3';
  ctx.beginPath();
  ctx.ellipse(20.5, -6.5, 2, 2.6, 0.3, 0, Math.PI * 2);
  ctx.ellipse(20.5, 6.5, 2, 2.6, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Tail lights flare under braking
  const braking = options.braking ?? false;
  ctx.fillStyle = braking ? '#ff4d4d' : '#b91c1c';
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = braking ? 16 : 4;
  ctx.fillRect(-23, -9, 2.5, 5);
  ctx.fillRect(-23, 4, 2.5, 5);
  ctx.shadowBlur = 0;

  ctx.restore();
}

// Headlight beam sprite, lamp at the left-middle, pointing +x. Rendered once
// per pixel so the cone has a soft edge, a hot spot and a long falloff instead
// of a flat transparent wedge.
const BEAM_LENGTH = 300;
const BEAM_HALF_WIDTH = 150;
const BEAM_SPRITE_SCALE = 2;
let beamSprite: HTMLCanvasElement | null = null;

function getBeamSprite() {
  if (beamSprite) return beamSprite;

  const w = BEAM_LENGTH * BEAM_SPRITE_SCALE;
  const h = BEAM_HALF_WIDTH * 2 * BEAM_SPRITE_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(w, h);
  const halfAngle = (26 * Math.PI) / 180;
  const smooth = (t: number) => t * t * (3 - 2 * t);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = px / BEAM_SPRITE_SCALE;
      const y = (py - h / 2) / BEAM_SPRITE_SCALE;
      const r = Math.hypot(x, y);
      if (r < 1 || x <= 0) continue;

      // Angular falloff: bright core, feathered edge
      const theta = Math.abs(Math.atan2(y, x)) / halfAngle;
      if (theta >= 1) continue;
      const angular = smooth(1 - theta);

      // Distance: quick fade-in off the lens, long tail to nothing
      const d = r / BEAM_LENGTH;
      if (d >= 1) continue;
      const tail = (1 - d) ** 1.8;
      const fadeIn = smooth(Math.min(1, r / 24));
      // Where the beam hits the road, a slightly brighter pool
      const pool = Math.exp(-(((d - 0.32) / 0.18) ** 2)) * 0.45;
      const intensity = Math.min(1, angular * fadeIn * (tail + pool * angular));

      // Warm white in the core, cooler toward the edges
      const i = (py * w + px) * 4;
      image.data[i] = 255;
      image.data[i + 1] = Math.round(236 + 12 * (1 - theta));
      image.data[i + 2] = Math.round(200 + 30 * theta);
      image.data[i + 3] = Math.round(intensity * 125);
    }
  }

  ctx.putImageData(image, 0, 0);
  beamSprite = canvas;
  return beamSprite;
}

const LAMP_OFFSETS = [[-6.5, -0.09], [6.5, 0.09]] as const;
const LAMP_FORWARD = 21;
const CAR_HALF_LENGTH = 24;
const CAR_HALF_WIDTH = 14;
// Each lamp removes this much light behind an occluder; where both lamps are
// blocked the shadow is darkest, where only one is you get a soft penumbra.
const SHADOW_PER_LAMP = 0.55;

export type LightSource = { id: string; x: number; y: number; angle: number; strength: number };
export type Occluder = { id: string; x: number; y: number; angle: number };

function lampPosition(car: { x: number; y: number; angle: number }, lateral: number) {
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  return { x: car.x + cos * LAMP_FORWARD - sin * lateral, y: car.y + sin * LAMP_FORWARD + cos * lateral };
}

function carCorners(car: Occluder) {
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  return ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([fx, fy]) => ({
    x: car.x + cos * CAR_HALF_LENGTH * fx - sin * CAR_HALF_WIDTH * fy,
    y: car.y + sin * CAR_HALF_LENGTH * fx + cos * CAR_HALF_WIDTH * fy,
  }));
}

/** Knocks the shadow a car casts from one lamp out of the light layer. */
function cutShadow(ctx: CanvasRenderingContext2D, lamp: Point, occluder: Occluder) {
  const toCenter = Math.atan2(occluder.y - lamp.y, occluder.x - lamp.x);
  let min: { p: Point; a: number } | null = null;
  let max: { p: Point; a: number } | null = null;
  for (const p of carCorners(occluder)) {
    // Angle relative to the lamp-to-car direction, so there is no wrap-around
    let a = Math.atan2(p.y - lamp.y, p.x - lamp.x) - toCenter;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    if (!min || a < min.a) min = { p, a };
    if (!max || a > max.a) max = { p, a };
  }
  if (!min || !max) return;

  const reach = BEAM_LENGTH * 1.5;
  const far = (p: Point) => {
    const dx = p.x - lamp.x;
    const dy = p.y - lamp.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * reach, y: p.y + (dy / len) * reach };
  };
  const minFar = far(min.p);
  const maxFar = far(max.p);
  ctx.beginPath();
  ctx.moveTo(min.p.x, min.p.y);
  ctx.lineTo(max.p.x, max.p.y);
  ctx.lineTo(maxFar.x, maxFar.y);
  ctx.lineTo(minFar.x, minFar.y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Paints every headlight into `light` (a transparent canvas already set to
 * world coordinates) and cuts out the shadows cars cast. Composite the result
 * over the scene with "screen" so lit surfaces, including other cars'
 * bodywork, brighten and shadowed ones do not.
 */
export function drawLightLayerV2(light: CanvasRenderingContext2D, sources: LightSource[], occluders: Occluder[]) {
  const sprite = getBeamSprite();

  for (const source of sources) {
    if (source.strength <= 0) continue;

    light.save();
    light.globalCompositeOperation = 'lighter';
    light.globalAlpha = source.strength;
    light.translate(source.x, source.y);
    light.rotate(source.angle);
    for (const [ly, toe] of LAMP_OFFSETS) {
      light.save();
      light.translate(LAMP_FORWARD, ly);
      light.rotate(toe);
      light.drawImage(sprite, 0, -BEAM_HALF_WIDTH, BEAM_LENGTH, BEAM_HALF_WIDTH * 2);
      light.restore();
    }
    light.restore();

    light.save();
    light.globalCompositeOperation = 'destination-out';
    light.fillStyle = `rgba(0, 0, 0, ${SHADOW_PER_LAMP})`;
    const forwardX = Math.cos(source.angle);
    const forwardY = Math.sin(source.angle);
    for (const occluder of occluders) {
      if (occluder.id === source.id) continue;
      const dx = occluder.x - source.x;
      const dy = occluder.y - source.y;
      // Only cars ahead of the lamps and within reach of the beam
      if (dx * forwardX + dy * forwardY <= 0) continue;
      if (Math.hypot(dx, dy) > BEAM_LENGTH + CAR_HALF_LENGTH * 2) continue;
      for (const [ly] of LAMP_OFFSETS) {
        cutShadow(light, lampPosition(source, ly), occluder);
      }
    }
    light.restore();
  }
}

/** Soft ring under the local car so you can find yourself in a pack. */
export function drawLocalMarker(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(x, y, 36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Screen-space vignette that pulls focus to the car. */
export function drawVignette(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const radius = Math.hypot(width, height) / 2;
  const gradient = ctx.createRadialGradient(width / 2, height / 2, radius * 0.45, width / 2, height / 2, radius);
  gradient.addColorStop(0, 'rgba(2, 6, 23, 0)');
  gradient.addColorStop(1, 'rgba(2, 6, 23, 0.4)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

const MINIMAP_BOUNDS = (() => {
  const xs = trackPoints.map((p) => p.x);
  const ys = trackPoints.map((p) => p.y);
  return {
    minX: Math.min(...xs) - HALF_TRACK_WIDTH,
    maxX: Math.max(...xs) + HALF_TRACK_WIDTH,
    minY: Math.min(...ys) - HALF_TRACK_WIDTH,
    maxY: Math.max(...ys) + HALF_TRACK_WIDTH,
  };
})();

export const MINIMAP_ASPECT = (MINIMAP_BOUNDS.maxX - MINIMAP_BOUNDS.minX) / (MINIMAP_BOUNDS.maxY - MINIMAP_BOUNDS.minY);

/** Draws the whole circuit and every car into a small canvas of its own. */
export function drawMinimap(
  canvas: HTMLCanvasElement,
  local: MinimapCar & { angle: number },
  others: MinimapCar[],
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const pad = 10;
  const scale = Math.min(
    (cssWidth - pad * 2) / (MINIMAP_BOUNDS.maxX - MINIMAP_BOUNDS.minX),
    (cssHeight - pad * 2) / (MINIMAP_BOUNDS.maxY - MINIMAP_BOUNDS.minY),
  );
  const toMap = (p: Point) => ({
    x: pad + (p.x - MINIMAP_BOUNDS.minX) * scale,
    y: pad + (p.y - MINIMAP_BOUNDS.minY) * scale,
  });

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  trackPoints.forEach((p, i) => {
    const m = toMap(p);
    if (i === 0) ctx.moveTo(m.x, m.y);
    else ctx.lineTo(m.x, m.y);
  });
  ctx.lineWidth = Math.max(4, TRACK_WIDTH * scale);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.stroke();

  // Start/finish tick
  const sf = toMap({ x: START_FINISH_X, y: START_FINISH_Y });
  const tick = Math.max(3, HALF_TRACK_WIDTH * scale);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sf.x, sf.y - tick);
  ctx.lineTo(sf.x, sf.y + tick);
  ctx.stroke();

  for (const car of others) {
    const m = toMap(car);
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Local car as an arrow pointing where it is heading
  const me = toMap(local);
  ctx.save();
  ctx.translate(me.x, me.y);
  ctx.rotate(local.angle);
  ctx.fillStyle = local.color;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -4.5);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-4, 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
