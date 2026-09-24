import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MIN_LAP_MS } from '../lib/leaderboardShared';
import { createLapState, updateLap } from './lap';
import {
  advanceClock,
  createFixedClock,
  MAX_STEPS_PER_FRAME,
  PHYSICS_HZ,
  STEP_MS,
  stepCar,
  type CarState,
} from './physics';
import { getGridSlotPosition, trackPoints } from './track';

function gridCar(): CarState {
  const start = getGridSlotPosition(0);
  return { x: start.x, y: start.y, vx: 0, vy: 0, angle: 0 };
}

/** Holds the throttle for `seconds` of wall-clock time on a screen refreshing at `hz`. */
function throttleFor(seconds: number, hz: number) {
  const car = gridCar();
  const clock = createFixedClock();
  const frameMs = 1000 / hz;
  let steps = 0;
  for (let time = 0; time <= seconds * 1000 + 1e-6; time += frameMs) {
    const frame = advanceClock(clock, time);
    for (let i = 0; i < frame.steps; i++) {
      stepCar(car, { gas: true, brake: false, steer: 0 });
      steps++;
    }
  }
  return { car, steps };
}

describe('fixed-step physics', () => {
  it('drives the same car at 30, 60, 120 and 144 Hz', () => {
    const reference = throttleFor(1, 60);
    assert.equal(reference.steps, PHYSICS_HZ);
    for (const hz of [30, 120, 144]) {
      const run = throttleFor(1, hz);
      assert.equal(run.steps, reference.steps, `${hz} Hz ran a different number of steps`);
      assert.deepEqual(run.car, reference.car, `${hz} Hz ended somewhere else`);
    }
  });

  it('keeps the tuned top speed of about 19.4 units per step', () => {
    // Up the long straight on the left of the circuit, already near full speed
    const car: CarState = { x: -1000, y: 3000, vx: 0, vy: -19, angle: -Math.PI / 2 };
    for (let i = 0; i < 60; i++) stepCar(car, { gas: true, brake: false, steer: 0 });
    assert.ok(Math.abs(Math.hypot(car.vx, car.vy) - 19.4) < 0.1, `top speed ${Math.hypot(car.vx, car.vy)}`);
  });

  it('drops time after a long stall instead of fast-forwarding', () => {
    const clock = createFixedClock();
    advanceClock(clock, 0);
    const frame = advanceClock(clock, 5000);
    assert.equal(frame.steps, MAX_STEPS_PER_FRAME);
    assert.equal(frame.dropped, true);
    const next = advanceClock(clock, 5000 + STEP_MS);
    assert.equal(next.steps, 1);
    assert.equal(next.dropped, false);
  });

  it('never reverses under braking', () => {
    const car = gridCar();
    car.vx = 5;
    for (let i = 0; i < 120; i++) stepCar(car, { gas: false, brake: true, steer: 0 });
    assert.ok(car.vx >= 0);
    assert.ok(Math.hypot(car.vx, car.vy) < 0.01);
  });
});

// A simple autopilot that chases a point ahead on a smoothed centreline.
// It laps in about 11.8 s; if a physics change makes it much faster, the
// leaderboard floor (MIN_LAP_MS) would start rejecting real laps.
function autopilotLaps(laps: number) {
  const raw: { x: number; y: number }[] = [];
  for (let i = 0; i < trackPoints.length - 1; i++) {
    const a = trackPoints[i];
    const b = trackPoints[i + 1];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 20);
    for (let k = 0; k < n; k++) raw.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const w = 15;
  const path = raw.map((_, i) => {
    let x = 0;
    let y = 0;
    for (let k = -w; k <= w; k++) {
      const p = raw[(i + k + raw.length) % raw.length];
      x += p.x;
      y += p.y;
    }
    return { x: x / (2 * w + 1), y: y / (2 * w + 1) };
  });

  const car = gridCar();
  const lap = createLapState();
  const times: number[] = [];
  let index = 0;
  for (let tick = 1; tick < PHYSICS_HZ * 120 && times.length < laps; tick++) {
    let best = index;
    let bestD = Infinity;
    for (let k = index; k < index + 60; k++) {
      const p = path[k % path.length];
      const d = (p.x - car.x) ** 2 + (p.y - car.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    index = best;
    const speed = Math.hypot(car.vx, car.vy);
    const target = path[(index + Math.round(8 + speed * 1.5)) % path.length];
    let error = Math.atan2(target.y - car.y, target.x - car.x) - car.angle;
    error = Math.atan2(Math.sin(error), Math.cos(error));
    const prev = { x: car.x, y: car.y };
    stepCar(car, { gas: true, brake: Math.abs(error) > 0.8 && speed > 8, steer: Math.abs(error) > 0.03 ? Math.sign(error) : 0 });
    const event = updateLap(lap, prev, car, tick);
    if (event?.type === 'finish') times.push(event.ticks * STEP_MS);
  }
  return times;
}

describe('lap-time floor', () => {
  it('sits well below what an autopilot can lap', () => {
    const times = autopilotLaps(2);
    assert.equal(times.length, 2, 'autopilot did not complete its laps');
    const fastest = Math.min(...times);
    assert.ok(fastest > 11000 && fastest < 13000, `autopilot lap was ${fastest} ms`);
    assert.ok(fastest - MIN_LAP_MS >= 2000, `floor ${MIN_LAP_MS} ms is within 2 s of a ${fastest} ms lap`);
  });
});
