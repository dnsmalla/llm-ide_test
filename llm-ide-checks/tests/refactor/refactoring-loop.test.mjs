// The built-in Refactoring loop: its stage list, ids, order and the
// refactorBatchesPerRun setting. Read from the generated default specs and
// decoded with the real model decoders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ui } from '../helpers/root.mjs';

const defaults = await ui('loop/native/defaults.generated.ts');
const model = await ui('loop/native/model.ts');

const refactor = defaults.DEFAULT_LOOP_SPECS.find((s) => s.defaultKey === 'refactor');
const stages = refactor.config.stages;

test('the Refactoring loop exists, is not the primary loop, and is opt-in', () => {
  assert.ok(refactor, 'a default loop with defaultKey "refactor"');
  assert.equal(refactor.name, 'Refactoring');
  assert.equal(refactor.isPrimary, false);
  assert.equal(refactor.runsOnSchedule, false);
});

test('its stage orders run 0..n-1 with no gaps or repeats', () => {
  assert.deepEqual(stages.map((s) => s.order), stages.map((_, i) => i));
});

test('every stage id is unique and lives under the refactor/ namespace', () => {
  const ids = stages.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith('refactor/'), id);
});

test('the first stage measures structure, before anything is changed', () => {
  assert.equal(stages[0].defaultKey, 'refactor-structure');
  assert.equal(stages[0].testOp, 'structure');
});

test('the plan step and the test-map step are both present', () => {
  const keys = stages.map((s) => s.defaultKey);
  assert.ok(keys.includes('refactor-plan'));
  assert.ok(keys.includes('refactor-test-map'));
});

test('the refactor loop decodes through the real model without losing stages', () => {
  const def = model.decodeDefinition(refactor, 2);
  assert.ok(def, 'decodeDefinition returns a definition');
  assert.equal(def.config.stages.length, stages.length);
  assert.ok(def.config.stages.every((s) => s.kind !== 'unsupported' || s.name), 'unknown kinds are flagged, not silently dropped');
});

test('refactorBatchesPerRun defaults to unset and decodes a positive count', () => {
  assert.equal(model.decodeConfig(refactor.config).refactorBatchesPerRun, null);
  assert.equal(model.decodeConfig({ ...refactor.config, refactorBatchesPerRun: 2 }).refactorBatchesPerRun, 2);
});

test('a non-numeric batch count is treated as unset rather than crashing', () => {
  assert.equal(model.decodeConfig({ ...refactor.config, refactorBatchesPerRun: 'two' }).refactorBatchesPerRun, null);
});
