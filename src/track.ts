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
