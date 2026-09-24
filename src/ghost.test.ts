import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatGap, recordSample, sampleGhost, startRecording, type GhostLap } from './ghost';

describe('ghost', () => {
  const recording = startRecording(0.5);
  for (let i = 0; i < 5; i++) recordSample(recording, i * 10, 0, i * 0.1);
  const ghost: GhostLap = { ticks: 4.5, splits: [], ...recording };

  it('interpolates between recorded steps', () => {
    const pose = sampleGhost(ghost, 2);
    assert.ok(pose);
    assert.equal(pose.x, 15);
    assert.ok(Math.abs(pose.angle - 0.15) < 1e-9);
  });

  it('holds the first sample before it and disappears after the lap', () => {
    assert.equal(sampleGhost(ghost, 0)?.x, 0);
    assert.equal(sampleGhost(ghost, 5), null);
  });

  it('formats gaps with a sign', () => {
    assert.equal(formatGap(340), '+0.34');
    assert.equal(formatGap(-120), '−0.12');
  });
});
