// Gantt model: date arithmetic, bar spans, drag-to-shift and the save queue.
// Pure functions from ui/screens/gantt/gantt-model.ts; no DOM, no core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ui } from '../helpers/root.mjs';

const gantt = await ui('gantt/gantt-model.ts');

const issue = (over = {}) => ({
  id: String(over.number ?? 1), title: 'Task', body: '', url: '', provider: 'github', repo: 'octo/repo',
  number: 1, state: 'open', labels: [], author: null, createdAt: null, updatedAt: null, isPR: false,
  milestone: null, assignees: [], ...over,
});
const schedule = (over = {}) => ({
  provider: 'github', repo: 'octo/repo', issueNumber: 1, startDate: null, dueDate: null,
  estimateDays: null, dependsOn: [], ...over,
});

test('dayNumber and dayString round-trip a calendar date', () => {
  const n = gantt.dayNumber('2026-11-13');
  assert.equal(typeof n, 'number');
  assert.equal(gantt.dayString(n), '2026-11-13');
  assert.equal(gantt.dayNumber('2026-11-14'), n + 1);
});

test('dayNumber rejects malformed and impossible dates', () => {
  assert.equal(gantt.dayNumber('2026-13-01'), null, 'month 13');
  assert.equal(gantt.dayNumber('2026-02-30'), null, 'February 30 must not roll over to March');
  assert.equal(gantt.dayNumber('yesterday'), null);
});

test('span: a start and a due date draw both days inclusively', () => {
  // The due day is the last day drawn only when it is the start of a new bar; here Jan 5 to Jan 7 draws Jan 5 and Jan 6.
  const r = gantt.span(schedule({ startDate: '2026-01-05', dueDate: '2026-01-07' }));
  assert.equal(r.start, gantt.dayNumber('2026-01-05'));
  assert.equal(r.end, gantt.dayNumber('2026-01-06'));
});

test('span: a start date plus an estimate spans the estimate', () => {
  const r = gantt.span(schedule({ startDate: '2026-01-05', estimateDays: 3 }));
  assert.equal(r.start, gantt.dayNumber('2026-01-05'));
  assert.equal(r.end, gantt.dayNumber('2026-01-07'));
});

test('span: a start date alone uses the default 7-day span', () => {
  const r = gantt.span(schedule({ startDate: '2026-01-05' }));
  assert.equal(r.end - r.start + 1, gantt.DEFAULT_SPAN_DAYS);
  assert.equal(gantt.DEFAULT_SPAN_DAYS, 7);
});

test('span: a due date alone ends the bar the day before it', () => {
  const r = gantt.span(schedule({ dueDate: '2026-01-07' }));
  assert.equal(r.start, gantt.dayNumber('2026-01-07') - 7);
  assert.equal(r.end, gantt.dayNumber('2026-01-07') - 1);
});

test('span: no dates gives no bar', () => {
  assert.deepEqual(gantt.span(null), { start: null, end: null });
  assert.deepEqual(gantt.span(schedule()), { start: null, end: null });
});

test('decodeSchedules keeps valid rows, drops malformed ones, and keeps null dates', () => {
  const body = {
    schedules: [
      { provider: 'github', repo: 'octo/repo', issueNumber: 3, startDate: '2026-02-01', dueDate: null, estimateDays: 2, dependsOn: [1] },
      { provider: 'github', repo: 'octo/repo' }, // no issue number: dropped
      'not an object', // dropped
    ],
  };
  const out = gantt.decodeSchedules(body);
  assert.equal(out.length, 1);
  assert.equal(out[0].issueNumber, 3);
  assert.equal(out[0].dueDate, null);
  assert.deepEqual(out[0].dependsOn, [1]);
});

test('buildRows: pull requests and other providers are not Gantt rows', () => {
  const rows = gantt.buildRows(
    [issue({ number: 1 }), issue({ number: 2, isPR: true }), issue({ number: 3, provider: 'gitlab' })],
    [],
    'github',
    'octo/repo',
  );
  assert.deepEqual(rows.map((r) => r.issue.number), [1]);
});

test('dragShift: a move under 3 px is a click, not a drag', () => {
  assert.equal(gantt.dragShift(100, 102, 20).moved, false);
  assert.equal(gantt.dragShift(100, 103, 20).moved, true);
});

test('dragShift: the day delta rounds to whole days and never divides by zero', () => {
  assert.deepEqual(gantt.dragShift(100, 160, 20), { moved: true, days: 3 }); // 60 px / 20 px = 3 days
  assert.equal(gantt.dragShift(100, 150, 20).days, 3, '2.5 days rounds half up (Math.round)');
  assert.equal(gantt.dragShift(100, 40, 20).days, -3, 'a leftward drag shifts the dates earlier');
  assert.equal(gantt.dragShift(0, 5, 0).days, 5, 'a zero day width is treated as 1 px');
});

test('enqueueShift: a second shift of the same issue accumulates on the queued item', () => {
  const row = gantt.buildRows([issue({ number: 9 })], [], 'github', 'octo/repo')[0];
  const queue = [];
  gantt.enqueueShift(queue, row, 2);
  gantt.enqueueShift(queue, row, 3);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].days, 5);
});

test('settleShift removes only the head item when nothing accumulated during the save', () => {
  const row = gantt.buildRows([issue({ number: 9 })], [], 'github', 'octo/repo')[0];
  const queue = [];
  gantt.enqueueShift(queue, row, 2);
  const item = queue[0];
  gantt.enqueueShift(queue, row, 1); // a shift arrives while the save is in flight
  gantt.settleShift(queue, item, 2); // saved 2, but the item now holds 3: keep it
  assert.equal(queue.length, 1);
  gantt.settleShift(queue, item, 3);
  assert.equal(queue.length, 0);
});

test('isWeekend agrees with the calendar', () => {
  for (const d of ['2026-11-14', '2026-11-16', '2026-11-17']) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    assert.equal(gantt.isWeekend(gantt.dayNumber(d)), dow === 0 || dow === 6, d);
  }
});
