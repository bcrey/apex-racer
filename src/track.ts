export type Point = { x: number; y: number };

// Track waypoints
export const trackPoints: Point[] = [
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
  {x: 0, y: 0}
];

export const TRACK_WIDTH = 400;
export const HALF_TRACK_WIDTH = TRACK_WIDTH / 2;
export const START_FINISH_LINE_WIDTH = 20;
export const START_FINISH_X = 900;
export const START_FINISH_Y = 0;
export const STARTING_GRID_OFFSET = 140;
export const GRID_ROW_SPACING = 120;
export const GRID_LANE_OFFSET = 80;
export const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#14b8a6'];

/** Where a car in starting slot `slot` lines up: two lanes, rows back from the line. */
export function getGridSlotPosition(slot: number): Point {
  return {
    x: START_FINISH_X - STARTING_GRID_OFFSET - Math.floor(slot / 2) * GRID_ROW_SPACING,
    y: slot % 2 === 0 ? -GRID_LANE_OFFSET : GRID_LANE_OFFSET,
  };
}

/** A starting slot's position. */
export function getGridPlacement(slotIndex: number) {
  return { slotIndex, ...getGridSlotPosition(slotIndex) };
}

export function isPlayerColor(color: unknown): color is string {
  return typeof color === 'string' && PLAYER_COLORS.includes(color);
}

/**
 * A car colour nobody else has: `preferred` if it is free, otherwise a random
 * free one. With every colour taken, any colour will do.
 */
export function pickFreeColor(taken: Iterable<string>, preferred?: string | null, random = Math.random) {
  const used = new Set(taken);
  if (isPlayerColor(preferred) && !used.has(preferred)) return preferred;
  const free = PLAYER_COLORS.filter((color) => !used.has(color));
  const pool = free.length > 0 ? free : PLAYER_COLORS;
  return pool[Math.floor(random() * pool.length)];
}

/** Lowest slot number nobody is using. */
export function getFirstOpenSlot(usedSlots: Iterable<number>) {
  const used = new Set(usedSlots);
  let slot = 0;
  while (used.has(slot)) {
    slot++;
  }
  return slot;
}

export function traceTrack(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(trackPoints[0].x, trackPoints[0].y);
  for (let i = 1; i < trackPoints.length; i++) {
    ctx.lineTo(trackPoints[i].x, trackPoints[i].y);
  }
}
