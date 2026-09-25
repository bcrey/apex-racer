import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NO_INPUT, type CarState } from './physics';
import {
  createAirState,
  isAirborne,
  rampAt,
  rampsInCell,
  rampsInRect,
  STUNT_CELL,
  stepStuntCar,
  type Ramp,
  type StuntEvent,
} from './stuntPark';
import { getGridSlotPosition } from './track';

const GAS = { gas: true, brake: false, steer: 0 };

function firstKicker(): Ramp {
  for (let i = 3; i < 60; i++) {
    const kicker = rampsInCell(i, 5).find((ramp) => ramp.kind === 'kicker');
    if (kicker) return kicker;
  }
  throw new Error('no kicker found');
}

/** A car at speed, lined up to hit `ramp` head-on from `distance` back. */
function carAimedAt(ramp: Ramp, distance: number, speed: number): CarState {
  const dx = Math.cos(ramp.angle);
  const dy = Math.sin(ramp.angle);
  return { x: ramp.x - dx * distance, y: ramp.y - dy * distance, vx: dx * speed, vy: dy * speed, angle: ramp.angle };
}

describe('stunt park layout', () => {
  it('generates the same ramps for a cell every time', () => {
    assert.deepEqual(rampsInCell(7, -3), rampsInCell(7, -3));
  });

  it('keeps the starting grid clear', () => {
    const spawn = getGridSlotPosition(0);
    for (const ramp of rampsInRect(spawn.x - 2000, spawn.y - 2000, spawn.x + 2000, spawn.y + 2000)) {
      const clearance = Math.hypot(ramp.x - spawn.x, ramp.y - spawn.y) - ramp.halfWidth;
      assert.ok(clearance > 300, `ramp ${ramp.id} is only ${Math.round(clearance)} from the grid`);
    }
  });

  it('keeps putting jumps everywhere you drive', () => {
    const far = rampsInRect(50 * STUNT_CELL, 50 * STUNT_CELL, 60 * STUNT_CELL, 60 * STUNT_CELL);
    assert.ok(far.length > 50, `expected plenty of ramps, got ${far.length}`);
  });

  it('finds the ramp under a point', () => {
    const kicker = firstKicker();
    assert.equal(rampAt(kicker)?.id, kicker.id);
  });
});

describe('stunt park jumps', () => {
  it('launches off a kicker hit at speed and lands again', () => {
    const kicker = firstKicker();
    const car = carAimedAt(kicker, kicker.halfLength + 20, 15);
    const air = createAirState();
    const events: StuntEvent[] = [];

    for (let i = 0; i < 400; i++) {
      const { event } = stepStuntCar(car, air, GAS);
      if (event) events.push(event);
      if (events.some((e) => e.type === 'land') && !isAirborne(air)) break;
    }

    assert.equal(events[0]?.type, 'launch');
    const landing = events.find((e) => e.type === 'land');
    assert.ok(landing && landing.type === 'land');
    assert.ok(landing.airTicks > 30, `expected real air time, got ${landing.airTicks} steps`);
    assert.equal(isAirborne(air), false);
  });

  it('does not launch a car that is barely moving', () => {
    const kicker = firstKicker();
    const car = carAimedAt(kicker, 0, 0.5);
    const air = createAirState();
    const { event } = stepStuntCar(car, air, NO_INPUT);
    assert.equal(event, null);
    assert.equal(isAirborne(air), false);
  });

  it('counts steering in the air as spin', () => {
    const kicker = firstKicker();
    const car = carAimedAt(kicker, kicker.halfLength + 20, 15);
    const air = createAirState();
    let landing: StuntEvent | null = null;
    for (let i = 0; i < 400 && !landing; i++) {
      const input = isAirborne(air) ? { gas: false, brake: false, steer: 1 } : GAS;
      const { event } = stepStuntCar(car, air, input);
      if (event?.type === 'land') landing = event;
    }
    assert.ok(landing && landing.type === 'land' && landing.spin > Math.PI, 'expected over half a turn of spin');
  });
});
