import test from 'node:test';
import assert from 'node:assert/strict';

// Pin the timezone before any Date is created: the bug being guarded only
// shows east of Greenwich.
process.env.TZ = 'Europe/Vilnius';
const { bucketByDay, bucketDate, pickCurrentMonth } = await import('../src/lib/statBuckets.js');

// HA's bucket for Tue 10 Nov 2026 (Vilnius, UTC+2) starts at 22:00 UTC on the 9th.
const tueStart = Date.UTC(2026, 10, 9, 22, 0, 0);

test('daily bucket is labelled by its local date, not the UTC parts', () => {
  const [item] = bucketByDay([{ t: tueStart, year: 2026, month: 11, day: 9, v: 12.5 }]);
  assert.deepEqual([item.year, item.month, item.day], [2026, 11, 10]);
  assert.equal(new Date(item.year, item.month - 1, item.day).getDay(), 2); // Tuesday
  assert.equal(item.v, 12.5);
});

test('payloads without a timestamp fall back to the date parts', () => {
  assert.deepEqual(bucketDate({ year: 2026, month: 11, day: 9 }), { year: 2026, month: 11, day: 9 });
  assert.deepEqual(bucketDate({ t: null, year: 2026, month: 11, day: 9 }), { year: 2026, month: 11, day: 9 });
});

test('negative and junk values clamp to zero', () => {
  assert.equal(bucketByDay([{ t: tueStart, v: -3 }])[0].v, 0);
  assert.equal(bucketByDay([{ t: tueStart, v: 'x' }])[0].v, 0);
  assert.deepEqual(bucketByDay(null), []);
});

test('current month is matched by local date', () => {
  // November's bucket starts 31 Oct 22:00 UTC; the UTC parts say October.
  const oct = { t: Date.UTC(2026, 8, 30, 21, 0, 0), year: 2026, month: 9, v: 300 };
  const nov = { t: Date.UTC(2026, 9, 31, 22, 0, 0), year: 2026, month: 10, v: 80 };
  const now = new Date(2026, 10, 10, 12, 0, 0);
  assert.equal(pickCurrentMonth([nov, oct], now), nov);
  assert.equal(pickCurrentMonth([oct, nov], now), nov);
});

test('falls back to the newest bucket when the month has none yet', () => {
  const oct = { t: Date.UTC(2026, 8, 30, 21, 0, 0), v: 300 };
  assert.equal(pickCurrentMonth([oct], new Date(2026, 10, 1, 0, 30, 0)), oct);
  assert.equal(pickCurrentMonth([], new Date()), null);
});
