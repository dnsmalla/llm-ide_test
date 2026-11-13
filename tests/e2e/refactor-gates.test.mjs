// End-to-end: the verification side of the Refactoring loop, on a small real project.
//
// The AI "Apply" step is replaced by a scripted, behaviour-preserving refactor, so this
// proves the gates (real graph-kit scan, the loop's real runCodeGraph snapshot/verify, a
// real test run), not the quality of what a model would write.
//
//   old tests + old graph  ->  refactor  ->  new graph + new code + new tests
//
// Known gaps are `todo` tests, so they are reported without failing the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scratchDir, ui, GRAPH_KIT_CLI } from '../helpers/root.mjs';

const { runCodeGraph } = await ui('loop/native/codegraph.ts');

const GRAPH = 'system/graph/graph.json';
const BEFORE = 'system/loop/refactor/graph/before.json';

// ---- the project before the refactor -------------------------------------------------
const OLD_CODE = {
  'src/pricing.mjs': `export function total(items, { region = 'JP', coupon = null } = {}) {
  let sum = 0;
  for (const i of items) sum += i.price * i.qty;
  if (coupon === 'HALF') sum = sum * 0.5;
  else if (coupon === 'TEN') sum = sum - 10;
  const rate = region === 'JP' ? 0.1 : region === 'EU' ? 0.2 : 0;
  return Math.round(sum * (1 + rate));
}
`,
};
const OLD_TESTS = {
  'tests/pricing.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/pricing.mjs';
const items = [{ price: 100, qty: 2 }];
test('JP adds 10% tax', () => assert.equal(total(items), 220));
test('EU adds 20% tax', () => assert.equal(total(items, { region: 'EU' }), 240));
test('an unknown region adds no tax', () => assert.equal(total(items, { region: 'US' }), 200));
test('the HALF coupon halves the sum before tax', () => assert.equal(total(items, { coupon: 'HALF' }), 110));
test('the TEN coupon takes 10 off before tax', () => assert.equal(total(items, { coupon: 'TEN' }), 209));
`,
};

// ---- the scripted refactor: extract tax and discount into their own modules -----------
const REFACTORED_CODE = {
  'src/discount.mjs': `export function discount(sum, coupon) {
  if (coupon === 'HALF') return sum * 0.5;
  if (coupon === 'TEN') return sum - 10;
  return sum;
}
`,
  'src/tax.mjs': `export function taxRate(region) {
  return region === 'JP' ? 0.1 : region === 'EU' ? 0.2 : 0;
}
`,
  'src/pricing.mjs': `import { discount } from './discount.mjs';
import { taxRate } from './tax.mjs';

export function total(items, { region = 'JP', coupon = null } = {}) {
  let sum = 0;
  for (const i of items) sum += i.price * i.qty;
  return Math.round(discount(sum, coupon) * (1 + taxRate(region)));
}
`,
};
const NEW_TESTS = {
  'tests/tax.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taxRate } from '../src/tax.mjs';
test('JP is 10%', () => assert.equal(taxRate('JP'), 0.1));
test('EU is 20%', () => assert.equal(taxRate('EU'), 0.2));
test('anything else is 0', () => assert.equal(taxRate('US'), 0));
`,
  'tests/discount.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discount } from '../src/discount.mjs';
test('HALF halves', () => assert.equal(discount(200, 'HALF'), 100));
test('TEN subtracts 10', () => assert.equal(discount(200, 'TEN'), 190));
test('no coupon leaves the sum', () => assert.equal(discount(200, null), 200));
`,
};

// ---- helpers ---------------------------------------------------------------------------
function put(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

/** The file API the loop's graph stage expects, backed by a real folder. */
function realFs(root) {
  return {
    async read(rel) {
      try { return { status: 'ok', text: fs.readFileSync(path.join(root, rel), 'utf8') }; }
      catch { throw Object.assign(new Error('missing'), { code: 'missing' }); }
    },
    async write(rel, text) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); },
    async create(rel) { fs.mkdirSync(path.join(root, rel), { recursive: true }); },
  };
}

/** Rescans the project root with the real graph-kit CLI into system/graph/graph.json. */
function rescanner(root) {
  return async () => {
    fs.mkdirSync(path.join(root, 'system/graph'), { recursive: true });
    const r = spawnSync(process.execPath, [GRAPH_KIT_CLI, 'code', root, '--out', path.join(root, GRAPH)], { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) throw new Error(`graph-kit exited ${r.status}: ${r.stderr}`);
  };
}

/** Runs the project's tests; returns pass/fail counts from node's TAP summary. */
function runTests(root) {
  // NODE_TEST_CONTEXT would make this nested run behave as a child of the outer one and print nothing.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/**/*.test.mjs'], { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
  const n = (k) => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] ?? NaN);
  return { status: r.status, pass: n('pass'), fail: n('fail'), tests: n('tests') };
}

const readGraph = (root, rel = GRAPH) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const ids = (g) => new Set(g.nodes.map((n) => n.id));
const hasEdge = (g, kind, from, to) => g.edges.some((e) => e.kind === kind && e.fromId === from && e.toId === to);

const base = scratchDir('e2e-refactor');
test.after(() => fs.rmSync(base, { recursive: true, force: true }));
let counter = 0;
const newProject = (extra = {}) => {
  const root = path.join(base, `p${counter++}`);
  put(root, { 'package.json': '{"type":"module"}\n', ...OLD_CODE, ...OLD_TESTS, ...extra });
  return root;
};

// ---- one project taken through the whole refactor, shared by the checks below ---------
const root = newProject();
const fsApi = realFs(root);

const oldTests = runTests(root);
const snapshot = await runCodeGraph(fsApi, 'snapshot', GRAPH, BEFORE, rescanner(root));
const graphBefore = readGraph(root);

put(root, REFACTORED_CODE);
put(root, NEW_TESTS);
const verify = await runCodeGraph(fsApi, 'verify', GRAPH, BEFORE, rescanner(root));
const graphAfter = readGraph(root);
const snapshotOnDisk = readGraph(root, BEFORE);
const testsAfter = runTests(root);

// ---- old state ---------------------------------------------------------------------------
test('before the refactor the old tests pass on the old code', () => {
  assert.equal(oldTests.status, 0);
  assert.equal(oldTests.fail, 0);
  assert.equal(oldTests.pass, 5);
});

test('the snapshot stage passes and saves the old graph where the loop keeps it', () => {
  assert.equal(snapshot.passed, true, snapshot.output);
  assert.deepEqual(snapshotOnDisk, graphBefore);
});

test('the old graph shows one file with one function and no extracted modules', () => {
  assert.ok(ids(graphBefore).has('symbol:src/pricing.mjs#total'));
  assert.ok(!ids(graphBefore).has('symbol:src/tax.mjs#taxRate'));
  assert.ok(!ids(graphBefore).has('symbol:src/discount.mjs#discount'));
});

// ---- new graph -----------------------------------------------------------------------------
test('the graph gate passes for a refactor that only adds structure', () => {
  assert.equal(verify.passed, true, verify.output);
});

test('the new graph keeps the public function and adds the extracted ones', () => {
  const after = ids(graphAfter);
  for (const id of ['symbol:src/pricing.mjs#total', 'symbol:src/tax.mjs#taxRate', 'symbol:src/discount.mjs#discount']) {
    assert.ok(after.has(id), `${id} is in the new graph`);
  }
});

test('every node of the old graph still exists in the new graph', () => {
  const after = ids(graphAfter);
  for (const n of graphBefore.nodes) assert.ok(after.has(n.id), `${n.id} survived`);
});

test('the new graph shows pricing now depends on the extracted modules, by import and by call', () => {
  assert.ok(hasEdge(graphAfter, 'imports', 'file:src/pricing.mjs', 'file:src/tax.mjs'));
  assert.ok(hasEdge(graphAfter, 'imports', 'file:src/pricing.mjs', 'file:src/discount.mjs'));
  assert.ok(hasEdge(graphAfter, 'calls', 'symbol:src/pricing.mjs#total', 'symbol:src/tax.mjs#taxRate'));
  assert.ok(hasEdge(graphAfter, 'calls', 'symbol:src/pricing.mjs#total', 'symbol:src/discount.mjs#discount'));
});

test('the new graph has more nodes and more edges than the old one, and no dangling edge', () => {
  assert.ok(graphAfter.nodes.length > graphBefore.nodes.length);
  assert.ok(graphAfter.edges.length > graphBefore.edges.length);
  const after = ids(graphAfter);
  for (const e of graphAfter.edges) assert.ok(after.has(e.fromId) && after.has(e.toId), `${e.fromId} -> ${e.toId}`);
});

// ---- new code and tests ----------------------------------------------------------------
test('the old tests, unchanged, still pass on the new code', () => {
  assert.equal(fs.readFileSync(path.join(root, 'tests/pricing.test.mjs'), 'utf8'), OLD_TESTS['tests/pricing.test.mjs']);
  assert.equal(testsAfter.status, 0);
  assert.equal(testsAfter.fail, 0);
});

test('the new tests add coverage: 5 old + 6 new tests all pass', () => {
  assert.equal(testsAfter.pass, 11);
});

test('the new tests catch a broken extracted module (mutation: JP rate 10% -> 20%)', () => {
  const m = newProject();
  put(m, REFACTORED_CODE);
  put(m, NEW_TESTS);
  assert.equal(runTests(m).fail, 0, 'the unmutated refactor is green');
  put(m, { 'src/tax.mjs': REFACTORED_CODE['src/tax.mjs'].replace("'JP' ? 0.1", "'JP' ? 0.2") });
  const r = runTests(m);
  assert.ok(r.fail >= 2, `expected the old and the new tax tests to fail, got ${r.fail}`);
});

test('a refactor that changes behaviour is caught by the old tests', () => {
  const bad = newProject();
  put(bad, REFACTORED_CODE);
  put(bad, { 'src/discount.mjs': 'export function discount(sum) { return sum; }\n' }); // coupons silently dropped
  const r = runTests(bad);
  assert.notEqual(r.status, 0);
  assert.ok(r.fail >= 2, 'the HALF and TEN coupon tests fail');
});

// ---- "did anything actually change?" ------------------------------------------------------
test('the code really changed: pricing.mjs differs and two new source files exist', () => {
  assert.notEqual(fs.readFileSync(path.join(root, 'src/pricing.mjs'), 'utf8'), OLD_CODE['src/pricing.mjs']);
  assert.ok(fs.existsSync(path.join(root, 'src/tax.mjs')));
  assert.ok(fs.existsSync(path.join(root, 'src/discount.mjs')));
});

test('characterization: the graph gate alone cannot tell a no-op from a refactor', async () => {
  const n = newProject();
  const api = realFs(n);
  await runCodeGraph(api, 'snapshot', GRAPH, BEFORE, rescanner(n));
  const r = await runCodeGraph(api, 'verify', GRAPH, BEFORE, rescanner(n)); // nothing was changed
  assert.equal(r.passed, true, 'an unchanged project passes as "graph stable"');
});

// ---- known gaps ----------------------------------------------------------------------------
test('the graph gate reports the file count for the real graph-kit output', { todo: 'runCodeGraph reads a files[] array that graph-kit does not write, so it reports 0 file(s)' }, () => {
  assert.match(verify.output, /3 file\(s\)/);
});

test('a batch that expects a counter to fall fails when it did not', { todo: 'the native gate ignores the batch "- Expect:" line; only the old Mac gate enforced it' }, async () => {
  const n = newProject();
  const api = realFs(n);
  await runCodeGraph(api, 'snapshot', GRAPH, BEFORE, rescanner(n));
  // runCodeGraph takes no expectation, so there is nothing to pass; a no-op batch that expected a change must fail
  const r = await runCodeGraph(api, 'verify', GRAPH, BEFORE, rescanner(n), { expect: 'cycleCount 1 -> 0' });
  assert.equal(r.passed, false, r.output);
});

test('a refactor that introduces an import cycle fails the graph gate', { todo: 'runCodeGraph counts cycles from calls[], which graph-kit does not write, so cycles are always 0' }, async () => {
  const c = newProject();
  const api = realFs(c);
  await runCodeGraph(api, 'snapshot', GRAPH, BEFORE, rescanner(c));
  put(c, {
    'src/a.mjs': "import { b } from './b.mjs';\nexport const a = () => b();\n",
    'src/b.mjs': "import { a } from './a.mjs';\nexport const b = () => a;\n",
  });
  const r = await runCodeGraph(api, 'verify', GRAPH, BEFORE, rescanner(c));
  assert.equal(r.passed, false, r.output);
  assert.match(r.output, /cycles/);
});
