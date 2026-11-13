// Code-graph query hygiene in extension/graphkit/graph.mjs: rollupCodeRefs
// turns raw symbol rows into file references, and refuses traversal and paths
// outside the allowed roots. Pure function; the database is pointed at a
// scratch file so importing the module never touches real data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratchDir, ext } from '../helpers/root.mjs';

const dir = scratchDir('graph-rollup');
process.env.LLMIDE_DB_PATH = path.join(dir, 'graph.db');
process.env.LLMIDE_JWT_SECRET = 'a'.repeat(48);
process.env.LLMIDE_VAULT_KEY = 'b'.repeat(48);
process.env.NODE_ENV = 'test';

const graph = await ext('graphkit/graph.mjs');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('rollupCodeRefs keeps one entry per file reference, the first one seen', () => {
  const out = graph.rollupCodeRefs([
    { ref: 'src/a.ts', title: 'a first', body: 'one', rank: 1 },
    { ref: 'src/a.ts', title: 'a second', body: 'two', rank: 2 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'a first');
});

test('rollupCodeRefs reads the file from the title when there is no ref', () => {
  const out = graph.rollupCodeRefs([{ title: 'src/b.ts:12 parseDate' }]);
  assert.deepEqual(out.map((r) => r.ref), ['src/b.ts']);
});

test('rollupCodeRefs refuses a path that climbs with ".."', () => {
  assert.deepEqual(graph.rollupCodeRefs([{ ref: '../secrets.txt', title: 'x' }]), []);
});

test('rollupCodeRefs refuses an absolute path outside the allowed roots', () => {
  assert.deepEqual(graph.rollupCodeRefs([{ ref: '/etc/passwd', title: 'x' }], []), []);
});

test('rollupCodeRefs caps the body excerpt at 240 characters', () => {
  const out = graph.rollupCodeRefs([{ ref: 'src/c.ts', title: 'c', body: 'x'.repeat(1000) }]);
  assert.equal(out[0].bodyExcerpt.length, 240);
});

test('rollupCodeRefs tolerates empty input', () => {
  assert.deepEqual(graph.rollupCodeRefs(null), []);
  assert.deepEqual(graph.rollupCodeRefs([]), []);
});
