import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../server/admin/stats.js';
import { hashPassword, verifyPassword, signToken, readToken } from '../server/admin/auth.js';

const NOW = Date.UTC(2026, 10, 20, 12);
const H = 3600 * 1000;

test('computeStats: open, overdue, avg resolution, breakdowns', () => {
  const s = computeStats([
    { status: 'new', category: 'damage', createdAt: NOW - 30 * H, updatedAt: NOW },
    { status: 'in_review', category: 'quality', createdAt: NOW - 2 * H, updatedAt: NOW, assignedTo: 'u1' },
    { status: 'resolved', category: 'damage', createdAt: NOW - 10 * H, resolvedAtMs: NOW - 6 * H, resolutionType: 'rewash', updatedAt: NOW },
    { status: 'rejected', category: 'billing', createdAt: NOW - 20 * H, resolvedAtMs: NOW - 14 * H, resolutionType: 'rejected', updatedAt: NOW }
  ], { now: NOW, slaHours: 24 });
  assert.equal(s.total, 4);
  assert.equal(s.open, 2);
  assert.equal(s.overdue, 1);
  assert.equal(s.unassigned, 1);
  assert.equal(s.avgResolutionHours, 5);
  assert.deepEqual(s.byCategory, { damage: 2, quality: 1, billing: 1 });
  assert.deepEqual(s.byResolution, { rewash: 1, rejected: 1 });
  assert.equal(s.trend.length, 14);
  assert.equal(s.trend.at(-1).created, 2); // only the 2h- and 10h-old tickets fall on today (UTC)
});

test('computeStats: empty input', () => {
  const s = computeStats([], { now: NOW });
  assert.equal(s.avgResolutionHours, null);
  assert.equal(s.open, 0);
});

test('password hashing verifies only the right password', () => {
  const h = hashPassword('correct horse battery');
  assert.ok(verifyPassword('correct horse battery', h));
  assert.ok(!verifyPassword('wrong password!!', h));
  assert.ok(!verifyPassword('x', 'garbage'));
});

test('session tokens: valid, tampered, expired', () => {
  const t = signToken({ _id: 'abc', role: 'admin' });
  assert.equal(readToken(t).role, 'admin');
  const [p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'abc', role: 'admin', exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(readToken(`${forged}.${s}`), null);
  assert.equal(readToken('nope'), null);
  const real = Date.now; Date.now = () => real() + 13 * 3600 * 1000;
  try { assert.equal(readToken(t), null); } finally { Date.now = real; }
});
