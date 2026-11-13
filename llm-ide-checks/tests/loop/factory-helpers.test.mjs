// Factory Loop helpers: write scopes per stage, the agent-run body, the
// guarded-path rule, the needs-decision summary and the setup command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ui } from '../helpers/root.mjs';

const factory = await ui('loop/native/factory.ts');
const {
  FACTORY_INTAKE_SKILL, FACTORY_PLAN_SKILL, FACTORY_REVIEW_SKILL, FACTORY_IMPLEMENT_SKILL,
  NEEDS_DECISION_SUMMARY,
} = factory;

const factoryLoop = { defaultKey: 'factory' };
const plainLoop = { defaultKey: null };

test('Intake, Plan and Review may write only under .factory/', () => {
  for (const skillId of [FACTORY_INTAKE_SKILL, FACTORY_PLAN_SKILL, FACTORY_REVIEW_SKILL]) {
    assert.equal(factory.writeScopeFor({ kind: 'skill', skillId }), '.factory', skillId);
  }
});

test('Implement has no write scope of its own', () => {
  assert.equal(factory.writeScopeFor({ kind: 'skill', skillId: FACTORY_IMPLEMENT_SKILL }), null);
  assert.equal(factory.writeScopeFor({ kind: 'shellCommand', skillId: null }), null);
});

test('Implement may not write the reports under .factory/ (denyWrite)', () => {
  const body = factory.agentRunBody({
    message: 'm',
    stage: { kind: 'skill', skillId: FACTORY_IMPLEMENT_SKILL, id: 'factory/implement' },
    repoRoot: '/work/tree',
    timeoutMs: 1000,
    projectRoot: '/work/tree',
    llmDocExists: false,
  });
  assert.equal(body.denyWrite, '.factory');
  assert.equal(body.writeScope, undefined);
});

test('Intake in a worktree gets the project llm-doc folder as an extra read root', () => {
  const body = factory.agentRunBody({
    message: 'm',
    stage: { kind: 'skill', skillId: FACTORY_INTAKE_SKILL, id: 'factory/intake' },
    repoRoot: '/work/worktree',
    timeoutMs: 1000,
    projectRoot: '/work/project',
    llmDocExists: true,
  });
  assert.equal(body.writeScope, '.factory');
  assert.deepEqual(body.extraRoots, ['/work/project/llm-doc']);
});

test('Intake in the project root itself gets no extra root', () => {
  const body = factory.agentRunBody({
    message: 'm',
    stage: { kind: 'skill', skillId: FACTORY_INTAKE_SKILL, id: 'factory/intake' },
    repoRoot: '/work/project/',
    timeoutMs: 1000,
    projectRoot: '/work/project',
    llmDocExists: true,
  });
  assert.equal(body.extraRoots, undefined);
});

test('outside a Factory loop every path is guarded', () => {
  const paths = ['.factory/REVIEW.md', 'src/a.ts'];
  assert.deepEqual(factory.guardedPaths(plainLoop, null, paths), paths);
});

test('an Intake run judges every path except the .factory/ reports', () => {
  const intake = { kind: 'skill', skillId: FACTORY_INTAKE_SKILL };
  assert.deepEqual(factory.guardedPaths(factoryLoop, intake, ['.factory/REVIEW.md', 'src/a.ts']), ['src/a.ts']);
});

test('an Implement run judges only CI and hook files; the .factory/ reports stay unjudged', () => {
  const implement = { kind: 'skill', skillId: FACTORY_IMPLEMENT_SKILL };
  const paths = ['.factory/REVIEW.md', 'src/a.ts', '.github/workflows/ci.yml'];
  assert.deepEqual(factory.guardedPaths(factoryLoop, implement, paths), ['.github/workflows/ci.yml']);
});

test('Implement is exempt from the test globs, but a repair (no stage) is not', () => {
  const paths = ['src/a.test.ts'];
  // A repair passes stage = null: the same paths are judged again.
  assert.deepEqual(factory.guardedPaths(factoryLoop, { kind: 'skill', skillId: FACTORY_IMPLEMENT_SKILL }, paths), []);
  assert.deepEqual(factory.guardedPaths(factoryLoop, null, paths), paths);
});

test('a failed Intake gate on READINESS.md becomes the needs-decision summary', () => {
  const summary = factory.needsDecisionSummary({
    passed: false,
    failedStage: { kind: 'artifactCheck', check: { verdict: { path: '.factory/READINESS.md', line: 'Verdict: ready' } } },
  });
  assert.equal(summary, NEEDS_DECISION_SUMMARY);
});

test('a passed run or another failure is not a needs-decision', () => {
  assert.equal(factory.needsDecisionSummary({ passed: true, failedStage: null }), null);
  assert.equal(factory.needsDecisionSummary({
    passed: false,
    failedStage: { kind: 'shellCommand', check: null },
  }), null);
});

test('withSetupCommand enables the install step for npm projects only', () => {
  const config = {
    stages: [{ kind: 'shellCommand', runOnce: true, command: '', enabled: false, disabledByDetection: true }],
  };
  const npm = factory.withSetupCommand(config, 'npm test');
  assert.equal(npm.stages[0].command, 'npm ci');
  assert.equal(npm.stages[0].enabled, true);
  assert.equal(factory.withSetupCommand(config, 'make test'), config, 'an unknown test command leaves the config alone');
  assert.equal(factory.withSetupCommand(config, null), config);
});

test('isFactoryLoop recognises the built-in Factory by its default key', () => {
  assert.equal(factory.isFactoryLoop(factoryLoop), true);
  assert.equal(factory.isFactoryLoop(plainLoop), false);
});
