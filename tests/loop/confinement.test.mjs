// Loop agent confinement: the rule that decides which tools and paths a
// headless Loop agent run may use. Tested on the real engine module in
// extension/llm_agent/sdk/loop-agent.mjs with a scratch repository on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratchDir, ext } from '../helpers/root.mjs';

const engine = await ext('llm_agent/sdk/loop-agent.mjs');
const repo = scratchDir('confinement');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.mkdirSync(path.join(repo, '.factory'), { recursive: true });
const inRepo = (rel) => path.join(repo, rel);

test.after(() => fs.rmSync(repo, { recursive: true, force: true }));

test('a tool outside the Loop tool set is refused with its name in the message', () => {
  const why = engine.loopToolRefusal('Bash', { command: 'ls' }, repo);
  assert.ok(why, 'Bash must be refused');
  assert.match(why, /Bash is not available in a Loop run/);
});

test('find-code is the one read-only search that is always allowed', () => {
  assert.equal(engine.loopToolRefusal(engine.LOOP_FIND_CODE_TOOL, {}, repo), null);
});

test('Read inside the repository is allowed', () => {
  assert.equal(engine.loopToolRefusal('Read', { file_path: inRepo('src/a.ts') }, repo), null);
});

test('Read outside the repository is refused', () => {
  const why = engine.loopToolRefusal('Read', { file_path: path.join(repo, '..', 'elsewhere.txt') }, repo);
  assert.ok(why);
  assert.match(why, /outside the Loop's repository/);
});

test('a read-only run refuses Edit and Write outright', () => {
  const why = engine.loopToolRefusal('Edit', { file_path: inRepo('src/a.ts') }, repo, { readOnly: true });
  assert.match(why, /read-only run/);
});

test('a scoped run may write only under its own folder', () => {
  const scope = { writeScope: '.factory' };
  assert.equal(engine.loopToolRefusal('Write', { file_path: inRepo('.factory/REVIEW.md') }, repo, scope), null);
  assert.match(engine.loopToolRefusal('Write', { file_path: inRepo('src/a.ts') }, repo, scope), /may write only under \.factory/);
});

test('an implement run may not write the Factory reports (denyWrite)', () => {
  const deny = { denyWrite: '.factory' };
  assert.match(engine.loopToolRefusal('Write', { file_path: inRepo('.factory/PLAN.md') }, repo, deny), /may not write under \.factory/);
  assert.equal(engine.loopToolRefusal('Write', { file_path: inRepo('src/a.ts') }, repo, deny), null);
});

test('patternTargetsSecret flags env and key globs but not ordinary source globs', () => {
  assert.equal(engine.patternTargetsSecret('.env*'), true);
  assert.equal(engine.patternTargetsSecret('*.pem'), true);
  assert.equal(engine.patternTargetsSecret('src/**/*.ts'), false);
  assert.equal(engine.patternTargetsSecret(''), false);
});

test('Grep always carries negative globs that hide secret files', () => {
  assert.ok(engine.LOOP_GREP_SECRET_EXCLUSIONS.length > 0);
  assert.ok(Object.isFrozen(engine.LOOP_GREP_SECRET_EXCLUSIONS));
});

test('the Loop tool set is exactly the file tools', () => {
  assert.deepEqual([...engine.LOOP_AGENT_TOOLS], ['Read', 'Glob', 'Grep', 'Edit', 'Write']);
});
