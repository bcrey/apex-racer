import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHECKPOINTS, createLapState, lineCrossing, updateLap } from './lap';
import { START_FINISH_X } from './track';

const beforeLine = { x: START_FINISH_X - 10, y: 0 };
const afterLine = { x: START_FINISH_X + 10, y: 0 };

describe('lap timing', () => {
  it('places the crossing between steps', () => {
    assert.equal(lineCrossing(beforeLine, { x: START_FINISH_X + 30, y: 0 }), 0.25);
    assert.equal(lineCrossing(afterLine, beforeLine), null, 'crossing backwards does not count');
    assert.equal(lineCrossing({ x: START_FINISH_X - 10, y: 500 }, { x: START_FINISH_X + 10, y: 500 }), null, 'off the track');
  });

  it('starts the clock at the first crossing, not before', () => {
    const lap = createLapState();
    assert.equal(updateLap(lap, { x: 700, y: 0 }, { x: 720, y: 0 }, 1), null);
    assert.equal(lap.running, false);
    const event = updateLap(lap, beforeLine, afterLine, 40);
    assert.deepEqual(event, { type: 'start', tick: 39.5 });
    assert.equal(lap.running, true);
  });

  it('needs every checkpoint before the line ends the lap', () => {
    const lap = createLapState();
    updateLap(lap, beforeLine, afterLine, 10);
    assert.equal(updateLap(lap, beforeLine, afterLine, 20), null, 'no checkpoints yet');

    CHECKPOINTS.forEach((checkpoint, index) => {
      const event = updateLap(lap, checkpoint, checkpoint, 100 * (index + 1));
      assert.equal(event?.type, 'checkpoint');
    });

    const finish = updateLap(lap, beforeLine, afterLine, 700);
    assert.ok(finish?.type === 'finish');
    assert.equal(finish.ticks, 699.5 - 9.5);
    assert.deepEqual(finish.splits, [90.5, 190.5, 290.5]);
    assert.equal(finish.interrupted, false);
    assert.equal(lap.startTick, 699.5, 'the next lap starts at the same crossing');
  });

  it('reports a lap interrupted by a stall', () => {
    const lap = createLapState();
    updateLap(lap, beforeLine, afterLine, 10);
    lap.interrupted = true;
    CHECKPOINTS.forEach((checkpoint, index) => updateLap(lap, checkpoint, checkpoint, 100 * (index + 1)));
    const finish = updateLap(lap, beforeLine, afterLine, 700);
    assert.ok(finish?.type === 'finish');
    assert.equal(finish.interrupted, true);
    assert.equal(lap.interrupted, false, 'the next lap starts clean');
  });
});
