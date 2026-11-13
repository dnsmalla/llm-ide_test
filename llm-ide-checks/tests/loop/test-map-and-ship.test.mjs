// Loop test ledger, test-result parsing, and the ship/diff model that decides
// what a finished run sends to a merge request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ui } from '../helpers/root.mjs';

const testmap = await ui('loop/native/testmap.ts');
const ship = await ui('loop/native/ship-model.ts');

test('parseTestResults reads Xcode, Jest-style and dot-reporter lines', () => {
  const out = testmap.parseTestResults([
    "Test Case '-[LoginTests testValid]' passed (0.01 seconds).",
    "Test Case '-[LoginTests testBroken]' failed (0.02 seconds).",
    '  ✓ parses a date (3 ms)',
    '  ✕ rejects a bad date (5 ms)',
  ].join('\n'));
  assert.deepEqual(out.passing, ['LoginTests testValid', 'parses a date'].sort());
  assert.deepEqual(out.failing, ['LoginTests testBroken', 'rejects a bad date'].sort());
});

test('parseTestResults ignores unrelated output', () => {
  assert.deepEqual(testmap.parseTestResults('compiling...\nDone in 2s\n'), { failing: [], passing: [] });
});

test('ledgerDiff reports new failures, still-failing tests and fixes', () => {
  const previous = { runId: 'r1', recordedAt: 'x', failing: ['a', 'b'], passing: ['c'] };
  const diff = testmap.ledgerDiff(previous, { failing: ['b', 'd'], passing: ['a', 'c'] }, false);
  assert.deepEqual(diff.newFailures, ['d']);
  assert.deepEqual(diff.stillFailing, ['b']);
  assert.deepEqual(diff.fixed, ['a']);
});

test('ledgerDiff counts a previous failure as fixed only when the run passed or the test passed', () => {
  const previous = { runId: 'r1', recordedAt: 'x', failing: ['a'], passing: [] };
  // "a" is absent from both lists: it did not run, so it is not fixed on a failed run.
  assert.deepEqual(testmap.ledgerDiff(previous, { failing: [], passing: [] }, false).fixed, []);
  assert.deepEqual(testmap.ledgerDiff(previous, { failing: [], passing: [] }, true).fixed, ['a']);
});

test('ledgerDiff with no previous ledger treats every failure as new', () => {
  assert.deepEqual(testmap.ledgerDiff(null, { failing: ['x'], passing: [] }, false).newFailures, ['x']);
});

test('detectTestStructure finds a package test directory from its package.json', async () => {
  const files = new Map([['extension/package.json', JSON.stringify({ scripts: { test: 'node --test tests/' } })]]);
  const dirs = new Set(['', 'extension', 'extension/tests']);
  const fake = {
    async list(p) {
      const key = p === '.' ? '' : p;
      if (!dirs.has(key)) throw new Error(`no such dir ${p}`);
      const prefix = key ? `${key}/` : '';
      const entries = [...dirs]
        .filter((d) => d !== '' && d !== key && d.startsWith(prefix) && !d.slice(prefix.length).includes('/'))
        .map((d) => ({ name: d.slice(prefix.length), kind: 'dir', path: d }));
      return { entries };
    },
    async read(p) {
      return files.has(p) ? { status: 'ok', text: files.get(p) } : { status: 'missing', text: '' };
    },
    async create() {}, async write() {},
  };
  const s = await testmap.detectTestStructure(fake, '', new Date('2026-11-13T00:00:00Z'));
  assert.equal(s.status, 'ok');
  assert.equal(s.roots.length, 1);
  assert.equal(s.roots[0].packageDir, 'extension');
  assert.equal(s.roots[0].testDir, 'extension/tests');
  assert.equal(s.roots[0].command, 'cd extension && npm test');
});

test('autoShipKind: a passed run and a failed verify both ship a draft, labelled', () => {
  assert.equal(ship.autoShipKind({ mode: 'full', statusCode: 'success', needsDecision: false, failedRole: null }), 'passed');
  assert.equal(ship.autoShipKind({ mode: 'full', statusCode: 'failed', needsDecision: false, failedRole: 'verify' }), 'testsFailing');
  assert.equal(ship.autoShipKind({ mode: 'full', statusCode: 'failed', needsDecision: false, failedRole: 'reviewGate' }), 'reviewRejected');
});

test('autoShipKind: intake-only runs, decisions and cancels never open a merge request', () => {
  assert.equal(ship.autoShipKind({ mode: 'intakeOnly', statusCode: 'success', needsDecision: false, failedRole: null }), null);
  assert.equal(ship.autoShipKind({ mode: 'full', statusCode: 'success', needsDecision: true, failedRole: null }), null);
  assert.equal(ship.autoShipKind({ mode: 'full', statusCode: 'cancelled', needsDecision: false, failedRole: null }), null);
});

test('autoShipTitle prefixes a failed run so the reviewer sees its state', () => {
  assert.equal(ship.autoShipTitle('Add export', 'passed'), 'Add export');
  assert.match(ship.autoShipTitle('Add export', 'testsFailing'), /^\[Tests failing\] Add export/);
});

test('splitDiffByFile splits at each diff header and keeps leading text as (changes)', () => {
  const text = [
    'stray note',
    'diff --git a/src/a.ts b/src/a.ts',
    '+line',
    'diff --git a/src/b.ts b/src/b.ts',
    '-old',
    '',
  ].join('\n');
  const files = ship.splitDiffByFile(text);
  assert.deepEqual(files.map((f) => f.path), ['(changes)', 'src/a.ts', 'src/b.ts']);
  assert.deepEqual(files[2].lines, ['diff --git a/src/b.ts b/src/b.ts', '-old'], 'trailing blank lines are dropped');
});

test('diffLineKind classes added, removed, hunk and context lines; file headers are context', () => {
  assert.equal(ship.diffLineKind('+added'), 'add');
  assert.equal(ship.diffLineKind('-removed'), 'del');
  assert.equal(ship.diffLineKind('@@ -1,2 +1,2 @@'), 'hunk');
  assert.equal(ship.diffLineKind('+++ b/src/a.ts'), 'ctx');
  assert.equal(ship.diffLineKind('--- a/src/a.ts'), 'ctx');
  assert.equal(ship.diffLineKind(' unchanged'), 'ctx');
});

test('decodeWorktreeDiff accepts both patch id spellings and defaults the rest', () => {
  const d = ship.decodeWorktreeDiff({ patch_id: 'abc', files: ['a.ts', 7], additions: 3 });
  assert.equal(d.patchId, 'abc');
  assert.deepEqual(d.files, ['a.ts']);
  assert.equal(d.additions, 3);
  assert.equal(d.deletions, 0);
  assert.equal(d.truncated, false);
});

test('reviewedPatchIdWarning warns only when the diff changed after Review passed', () => {
  const sha = 'a'.repeat(64);
  const other = 'b'.repeat(64);
  assert.equal(ship.reviewedPatchIdWarning(sha, sha), null);
  assert.match(ship.reviewedPatchIdWarning(sha, other), /Re-run Review/);
  assert.equal(ship.reviewedPatchIdWarning('not-a-hash', other), null, 'an older record is not compared');
  assert.equal(ship.reviewedPatchIdWarning(sha, null), null, 'a diff still loading is not compared');
});

test('discardWarning says exactly what is deleted and that the remote request stays', () => {
  const text = ship.discardWarning({ changedFiles: 2, localCommits: 1, pushed: false }, { provider: 'gitlab' });
  assert.match(text, /2 changed files and 1 commit that was never pushed will be deleted\./);
  assert.match(text, /The remote branch and the open merge request stay\./);
  assert.equal(ship.discardWarning({ changedFiles: 0, localCommits: 0, pushed: true }), 'Nothing unpushed will be lost.');
});

test('decodeWorktreeStatus rejects a status with a missing or negative count', () => {
  assert.equal(ship.decodeWorktreeStatus({ changedFiles: -1, localCommits: 0, pushed: true }), null);
  assert.deepEqual(ship.decodeWorktreeStatus({ changedFiles: 1.9, localCommits: 0, pushed: true }), { changedFiles: 1, localCommits: 0, pushed: true });
});
