import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  isLeaderboardAdmin,
  issueLapToken,
  LAP_TOKEN_TOLERANCE_MS,
  leaderboardAdminRefusal,
  parseLapSubmission,
  readLapToken,
} from './leaderboard';
import { MIN_LAP_MS } from './leaderboardShared';

const LAP_MS = 20000;

describe('lap submissions', () => {
  it('accepts a lap that took as long as it claims', () => {
    const lapToken = issueLapToken(1_000_000);
    const result = parseLapSubmission({ initials: 'abc', timeMs: LAP_MS, lapToken }, 1_000_000 + LAP_MS + 400);
    assert.deepEqual(result, { initials: 'ABC', timeMs: LAP_MS, timeZone: undefined, lapToken });
  });

  it('allows for a slow lap-start request', () => {
    const lapToken = issueLapToken(0);
    assert.ok(!('error' in parseLapSubmission({ timeMs: LAP_MS, lapToken }, LAP_MS - LAP_TOKEN_TOLERANCE_MS + 1)));
  });

  it('rejects a lap submitted sooner than the time it claims', () => {
    const lapToken = issueLapToken(0);
    assert.ok('error' in parseLapSubmission({ timeMs: LAP_MS, lapToken }, 0));
    assert.ok('error' in parseLapSubmission({ timeMs: LAP_MS, lapToken }, LAP_MS - LAP_TOKEN_TOLERANCE_MS - 1));
  });

  it('rejects impossible times', () => {
    const lapToken = issueLapToken(0);
    const result = parseLapSubmission({ timeMs: MIN_LAP_MS - 1, lapToken }, MIN_LAP_MS);
    assert.ok('error' in result);
  });

  it('rejects a missing or forged token', () => {
    assert.ok('error' in parseLapSubmission({ timeMs: LAP_MS }));
    const [issued, nonce] = issueLapToken(0).split('.');
    const forged = `${Number(issued) - 60_000}.${nonce}.not-a-signature`;
    assert.equal(readLapToken(forged), null);
    assert.ok('error' in parseLapSubmission({ timeMs: LAP_MS, lapToken: forged }, LAP_MS));
  });

  it('rejects old tokens', () => {
    const lapToken = issueLapToken(0);
    assert.ok('error' in parseLapSubmission({ timeMs: 60 * 60 * 1000, lapToken }, 60 * 60 * 1000));
  });
});

describe('leaderboard admin', () => {
  const original = process.env.LEADERBOARD_ADMIN_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.LEADERBOARD_ADMIN_TOKEN;
    else process.env.LEADERBOARD_ADMIN_TOKEN = original;
  });

  it('refuses everyone when no admin token is set', () => {
    delete process.env.LEADERBOARD_ADMIN_TOKEN;
    assert.equal(isLeaderboardAdmin('Bearer anything'), false);
    assert.equal(leaderboardAdminRefusal().status, 403);
  });

  it('accepts only the configured token', () => {
    process.env.LEADERBOARD_ADMIN_TOKEN = 'correct horse';
    assert.equal(isLeaderboardAdmin('Bearer correct horse'), true);
    assert.equal(isLeaderboardAdmin('bearer correct horse'), true);
    assert.equal(isLeaderboardAdmin('Bearer wrong'), false);
    assert.equal(isLeaderboardAdmin('correct horse'), false);
    assert.equal(isLeaderboardAdmin(null), false);
    assert.equal(leaderboardAdminRefusal().status, 401);
  });
});
