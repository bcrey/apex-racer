import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLAYER_COLORS, pickFreeColor } from './track';

describe('car colours', () => {
  it('never picks a colour someone already has', () => {
    const taken = PLAYER_COLORS.slice(0, 7);
    for (let i = 0; i < 50; i++) {
      assert.ok(!taken.includes(pickFreeColor(taken)));
    }
  });

  it('keeps the preferred colour when it is free', () => {
    assert.equal(pickFreeColor([PLAYER_COLORS[0]], PLAYER_COLORS[3]), PLAYER_COLORS[3]);
  });

  it('passes over a preferred colour that is taken', () => {
    assert.notEqual(pickFreeColor([PLAYER_COLORS[3]], PLAYER_COLORS[3]), PLAYER_COLORS[3]);
  });

  it('spreads joiners across the palette', () => {
    const picks = new Set(Array.from({ length: 200 }, () => pickFreeColor([])));
    assert.ok(picks.size > 5, `only ${picks.size} distinct colours`);
  });

  it('still gives a colour when every one is taken', () => {
    assert.ok(PLAYER_COLORS.includes(pickFreeColor(PLAYER_COLORS)));
  });
});
