// Issue schedule overlay (the Gantt's saved dates per issue), tested against
// the real core store in extension/kb/db.mjs. Uses a scratch database so the
// developer's own llm-ide data is never touched.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratchDir, ext } from '../helpers/root.mjs';

const dir = scratchDir('issue-schedule');
process.env.LLMIDE_JWT_SECRET = 'a'.repeat(48);
process.env.LLMIDE_VAULT_KEY = 'b'.repeat(48);
process.env.NODE_ENV = 'test';
process.env.LLMIDE_DB_PATH = path.join(dir, 'schedule.db');

const db = await ext('kb/db.mjs');
const users = await ext('server/users.mjs');
const REPO = 'octo/repo';
let userA;
let userB;

before(() => {
  db.getDb();
  const make = (tag) => users.registerUser(db.getDb(), {
    email: `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    password: 'CorrectHorseBattery',
    displayName: tag,
  }).id;
  userA = make('alpha');
  userB = make('bravo');
});

test('upsert then list returns the stored schedule', () => {
  const saved = db.upsertIssueSchedule(userA, {
    provider: 'github', repo: REPO, issueNumber: 7,
    startDate: '2026-07-01', dueDate: '2026-07-10', estimateDays: 3.5, dependsOn: [4, 5],
  });
  assert.equal(saved.startDate, '2026-07-01');
  assert.equal(saved.dueDate, '2026-07-10');
  assert.equal(saved.estimateDays, 3.5);
  assert.deepEqual(saved.dependsOn, [4, 5]);
  const list = db.listIssueSchedules(userA, { provider: 'github', repo: REPO });
  assert.equal(list.length, 1);
  assert.equal(list[0].issueNumber, 7);
});

test('a schedule is visible only to the user who saved it', () => {
  db.upsertIssueSchedule(userA, { provider: 'github', repo: REPO, issueNumber: 8, startDate: '2026-07-01' });
  assert.equal(db.listIssueSchedules(userB, { provider: 'github', repo: REPO }).length, 0);
});

test('a null field clears the stored value on the next upsert', () => {
  db.upsertIssueSchedule(userA, { provider: 'github', repo: REPO, issueNumber: 9, startDate: '2026-08-01', dueDate: '2026-08-05' });
  const cleared = db.upsertIssueSchedule(userA, { provider: 'github', repo: REPO, issueNumber: 9, startDate: '2026-08-01', dueDate: null });
  assert.equal(cleared.dueDate, null);
});

test('a value that is not a YYYY-MM-DD date is refused', () => {
  assert.throws(() => db.upsertIssueSchedule(userA, {
    provider: 'github', repo: REPO, issueNumber: 10, startDate: 'yesterday',
  }), /YYYY-MM-DD/);
});

// KNOWN GAP: the core checks only the YYYY-MM-DD shape (kb/issue-schedule.mjs normDate), so an impossible
// calendar date is stored. The desktop Gantt rejects the same string (dayNumber returns null), so the
// row silently loses its bar. Reported as a TODO until the core validates the calendar too.
test('an impossible calendar date such as 2026-13-01 is refused', { todo: 'core validates shape only (normDate)' }, () => {
  assert.throws(() => db.upsertIssueSchedule(userA, {
    provider: 'github', repo: REPO, issueNumber: 12, startDate: '2026-13-01',
  }));
});

test('delete removes only the named schedule', () => {
  db.upsertIssueSchedule(userA, { provider: 'github', repo: REPO, issueNumber: 11, startDate: '2026-09-01' });
  db.deleteIssueSchedule(userA, { provider: 'github', repo: REPO, issueNumber: 11 });
  const numbers = db.listIssueSchedules(userA, { provider: 'github', repo: REPO }).map((s) => s.issueNumber);
  assert.equal(numbers.includes(11), false);
  assert.equal(numbers.includes(7), true);
});

test.after(() => {
  try { db.closeDb(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});
