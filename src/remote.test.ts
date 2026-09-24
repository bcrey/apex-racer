import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyNetworkState, createRemoteCar, stepRemoteCar } from './remote';

const base = { id: 'a', initials: 'ABC', color: '#fff', x: 0, y: 0, angle: 0, vx: 0, vy: 0 };

describe('remote cars', () => {
  it('eases onto a corrected position instead of jumping', () => {
    const car = createRemoteCar(base);
    applyNetworkState(car, { x: 50, y: 0, angle: 0, vx: 0, vy: 0 });
    assert.equal(car.x, 0, 'no jump when the update lands');
    stepRemoteCar(car);
    assert.ok(car.x > 0 && car.x < 50);
    for (let i = 0; i < 30; i++) stepRemoteCar(car);
    assert.ok(Math.abs(car.x - 50) < 0.1);
  });

  it('coasts on its last velocity between updates', () => {
    const car = createRemoteCar({ ...base, vx: 10 });
    for (let i = 0; i < 6; i++) stepRemoteCar(car);
    assert.ok(Math.abs(car.x - 60) < 1e-9);
  });

  it('jumps straight to a far-away position', () => {
    const car = createRemoteCar(base);
    applyNetworkState(car, { x: 2000, y: 0, angle: 1, vx: 0, vy: 0 });
    assert.equal(car.x, 2000);
    assert.equal(car.prevX, 2000);
  });
});
