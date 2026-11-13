// Graph UI model: decoding graph.json, search ranking, level-of-detail budget,
// edge weights, the file tree, the community/kind filters and the cycle
// counter the Loop uses. Pure modules under ui/screens/graph and loop/native.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ui } from '../helpers/root.mjs';

const decode = await ui('graph/decode.ts');
const search = await ui('graph/search.ts');
const lod = await ui('graph/lod.ts');
const weights = await ui('graph/weights.ts');
const tree = await ui('graph/path-tree.ts');
const filters = await ui('graph/filters.ts');
const codegraph = await ui('loop/native/codegraph.ts');

const doc = (nodes, edges = []) => JSON.stringify({ schemaVersion: 1, nodes, edges, layers: [], tour: [] });
const file = (id, p) => ({ id: `file:${p}`, title: p.split('/').pop(), kind: 'file', metadata: { path: p } });
const symbol = (id, title) => ({ id: `symbol:${id}`, title, kind: 'symbol', metadata: { symbolKind: 'function' } });

test('decodeGraph reads a graph document: titles, paths and edge kinds', () => {
  const m = decode.decodeGraph(doc(
    [file('a', 'src/app.ts'), symbol('start', 'start'), file('b', 'src/db.ts')],
    [
      { fromId: 'file:src/app.ts', toId: 'symbol:start', kind: 'contains', confidence: 'EXTRACTED' },
      { fromId: 'file:src/app.ts', toId: 'file:src/db.ts', kind: 'imports', confidence: 'EXTRACTED' },
    ],
  ));
  assert.equal(m.format, 'graph-document-1');
  assert.equal(m.n, 3);
  assert.deepEqual(m.titles, ['app.ts', 'start', 'db.ts']);
  assert.equal(m.paths[0], 'src/app.ts');
  assert.equal(m.paths[1], null, 'a symbol has no file path');
  assert.deepEqual([...m.edgeKinds].sort(), ['contains', 'imports']);
});

test('decodeGraph drops edges whose endpoints do not exist', () => {
  const m = decode.decodeGraph(doc(
    [file('a', 'src/a.ts')],
    [{ fromId: 'file:src/a.ts', toId: 'file:src/missing.ts', kind: 'imports', confidence: 'EXTRACTED' }],
  ));
  assert.equal(m.m, 0, 'an edge to an unknown node is not kept');
});

test('decodeGraph refuses text that is not JSON with a safe message', () => {
  assert.throws(() => decode.decodeGraph('{ not json'), (e) => e instanceof decode.GraphDecodeError && /not valid JSON/.test(e.message));
});

test('decodeGraph refuses a document from a newer schema', () => {
  assert.throws(() => decode.decodeGraph(JSON.stringify({ schemaVersion: 9, nodes: [] })), /newer than this app understands/);
});

test('decodeGraph refuses an object that is neither a kit file nor a document', () => {
  assert.throws(() => decode.decodeGraph('{"hello":1}'), /neither files\[\].*nor nodes\[\]/);
});

test('searchNodes ranks exact title, then prefix, then substring, then path', () => {
  const m = decode.decodeGraph(doc([
    file('u', 'src/utils.ts'),          // title "utils.ts" does not match "parse"; path does, last
    file('x', 'src/xparse.ts'),         // substring
    file('p', 'src/parser.ts'),         // prefix
    file('e', 'src/parse'),             // exact (title "parse")
  ]));
  const hits = [...search.searchNodes(m, 'parse')].map((i) => m.titles[i]);
  assert.deepEqual(hits, ['parse', 'parser.ts', 'xparse.ts']);
});

test('searchNodes matches a path that the title does not contain', () => {
  const m = decode.decodeGraph(doc([file('u', 'src/billing/invoice.ts')]));
  assert.equal(search.searchNodes(m, 'billing').length, 1);
});

test('searchNodes returns nothing for an empty or whitespace query', () => {
  const m = decode.decodeGraph(doc([file('a', 'a.ts')]));
  assert.equal(search.searchNodes(m, '   ').length, 0);
});

test('searchNodes respects its limit', () => {
  const nodes = Array.from({ length: 10 }, (_, i) => file(`n${i}`, `src/item${i}.ts`));
  const m = decode.decodeGraph(doc(nodes));
  assert.equal(search.searchNodes(m, 'item', 3).length, 3);
});

test('planLod shows everything for a small graph', () => {
  const plan = lod.planLod(10, 5, 1, new Uint32Array(lod.WEIGHT_BUCKETS));
  assert.equal(plan.nodeFraction, 1);
  assert.equal(plan.labelFraction, 1);
  assert.equal(plan.edgeFloor, 0);
});

test('planLod thins a large graph to the node budget', () => {
  const big = lod.NODE_BUDGET * 10;
  const plan = lod.planLod(big, 0, 1, new Uint32Array(lod.WEIGHT_BUCKETS));
  assert.ok(plan.nodeFraction < 1);
  assert.ok(plan.nodeFraction * big <= lod.NODE_BUDGET * 1.01);
  assert.equal(typeof plan.key, 'string');
});

test('edgeWeight: a structural edge is full weight; ambiguous and inferred edges are discounted', () => {
  assert.equal(weights.edgeWeight('contains', 0), 1.0);
  assert.equal(weights.edgeWeight('contains', 2), 0.45);
  assert.equal(weights.edgeWeight('contains', 1), 0.75);
  assert.equal(weights.edgeWeight('madeUpKind', 0), weights.EDGE_BASE_WEIGHT.relatedTo, 'an unknown kind falls back');
});

test('parseConfidence maps the three labels and defaults to EXTRACTED', () => {
  assert.equal(weights.parseConfidence('EXTRACTED'), 0);
  assert.equal(weights.parseConfidence('INFERRED'), 1);
  assert.equal(weights.parseConfidence('AMBIGUOUS'), 2);
  assert.equal(weights.parseConfidence('something else'), 0);
});

test('buildPathTree nests folders, lists folders before files, and ignores null paths', () => {
  const root = tree.buildPathTree(['src/b.ts', 'src/a/x.ts', null, 'README.md']);
  assert.deepEqual(root.children.map((c) => `${c.kind}:${c.name}`), ['dir:src', 'file:README.md']);
  const src = root.children[0];
  assert.deepEqual(src.children.map((c) => c.name), ['a', 'b.ts']);
  assert.equal(tree.fileCount(root), 3);
});

test('isDocKind separates documentation nodes from code nodes', () => {
  assert.equal(filters.isDocKind('docPage'), true);
  assert.equal(filters.isDocKind('memoryChunk'), true);
  assert.equal(filters.isDocKind('file'), false);
  assert.equal(filters.isDocKind('symbol'), false);
});

test('initialFilters starts at the Mac default weight floor with every kind shown', () => {
  const f = filters.initialFilters();
  assert.equal(f.minWeight, filters.DEFAULT_MIN_WEIGHT);
  assert.equal(f.minWeight, 0.3);
  assert.equal(f.hiddenKinds.size, 0);
  assert.equal(f.preset, 'all');
});

test('cycleCount counts strongly connected import groups, including a self-loop', () => {
  assert.equal(codegraph.cycleCount([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'c', to: 'd' }]), 1);
  assert.equal(codegraph.cycleCount([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]), 0, 'a chain has no cycle');
  assert.equal(codegraph.cycleCount([{ from: 'x', to: 'x' }]), 1, 'a self-edge is one cycle');
  assert.equal(codegraph.cycleCount([{ from: '', to: 'b' }]), 0, 'an edge without an endpoint is ignored');
});
