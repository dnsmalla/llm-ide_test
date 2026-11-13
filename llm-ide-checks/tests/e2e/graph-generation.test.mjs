// End-to-end: graph-kit scans a small known project and writes graph.json.
// The output is checked against what the fixture actually contains, then fed
// through the core's own node/edge normaliser (the consumer's contract).
//
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scratchDir, ext, GRAPH_KIT_CLI } from '../helpers/root.mjs';

const { normalizeNode, normalizeEdge } = await ext('connectors/structure-graph.mjs');

const PY = {
  'pkg/b.py': 'def helper(x):\n    return x + 1\n',
  'pkg/a.py': 'from pkg.b import helper\n\nclass Runner:\n    def run(self, v):\n        return helper(v)\n',
  'pkg/c.py': 'def standalone():\n    return 3\n',
};

function writeProject(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

function runGraphKit(projectDir) {
  const out = path.join(projectDir, '..', `graph-${path.basename(projectDir)}-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [GRAPH_KIT_CLI, 'code', projectDir, '--out', out], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, `graph-kit exited ${r.status}: ${r.stderr}`);
  return { graph: JSON.parse(fs.readFileSync(out, 'utf8')), bytes: fs.readFileSync(out, 'utf8') };
}

const root = scratchDir('e2e-graph');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const proj = path.join(root, 'project');
writeProject(proj, PY);
const first = runGraphKit(proj);
const nodesById = new Map(first.graph.nodes.map((n) => [n.id, n]));
const hasEdge = (g, fromId, toId, kind) =>
  g.edges.some((e) => e.fromId === fromId && e.toId === toId && e.kind === kind);

test('the CLI writes a graph document with a schema version and its three arrays', () => {
  assert.equal(first.graph.schemaVersion, 1);
  for (const k of ['nodes', 'edges', 'layers']) assert.ok(Array.isArray(first.graph[k]), `${k} is an array`);
});

test('every fixture file is a file node carrying its repo-relative path', () => {
  for (const rel of Object.keys(PY)) {
    const node = nodesById.get(`file:${rel}`);
    assert.ok(node, `file node for ${rel}`);
    assert.equal(node.kind, 'file');
    assert.equal(node.metadata.path, rel);
  }
});

test('every symbol in the fixture is a node at the line where it is defined', () => {
  const expected = [
    ['symbol:pkg/a.py#Runner', 'Runner', 'L3', 'class'],
    ['symbol:pkg/a.py#run', 'run', 'L4', 'function'],
    ['symbol:pkg/b.py#helper', 'helper', 'L1', 'function'],
    ['symbol:pkg/c.py#standalone', 'standalone', 'L1', 'function'],
  ];
  for (const [id, title, line, symbolKind] of expected) {
    const node = nodesById.get(id);
    assert.ok(node, `symbol node ${id}`);
    assert.equal(node.title, title);
    assert.equal(node.metadata.line, line);
    assert.equal(node.metadata.symbolKind, symbolKind);
  }
});

test('each symbol is contained by the file that defines it', () => {
  assert.ok(hasEdge(first.graph, 'file:pkg/a.py', 'symbol:pkg/a.py#Runner', 'contains'));
  assert.ok(hasEdge(first.graph, 'file:pkg/b.py', 'symbol:pkg/b.py#helper', 'contains'));
  assert.ok(hasEdge(first.graph, 'file:pkg/c.py', 'symbol:pkg/c.py#standalone', 'contains'));
});

test('every edge points at a node that exists', () => {
  for (const e of first.graph.edges) {
    assert.ok(nodesById.has(e.fromId), `from ${e.fromId}`);
    assert.ok(nodesById.has(e.toId), `to ${e.toId}`);
  }
});

test('the same project always produces byte-identical output', () => {
  const again = runGraphKit(proj);
  assert.equal(again.bytes, first.bytes);
});

test('the graph follows the code: a new function appears, and a removed one disappears', () => {
  writeProject(proj, { 'pkg/c.py': 'def standalone():\n    return 3\n\ndef added_later():\n    return 4\n' });
  const afterAdd = runGraphKit(proj).graph;
  assert.ok(afterAdd.nodes.some((n) => n.id === 'symbol:pkg/c.py#added_later'), 'added function is in the graph');

  writeProject(proj, { 'pkg/b.py': '' });
  const afterRemove = runGraphKit(proj).graph;
  assert.ok(!afterRemove.nodes.some((n) => n.id === 'symbol:pkg/b.py#helper'), 'removed function is gone');
});

test('the core normaliser keeps every generated node and edge', () => {
  for (const n of first.graph.nodes) {
    assert.ok(normalizeNode(n), `node ${n.id} is accepted`);
  }
  for (const e of first.graph.edges) {
    assert.ok(normalizeEdge(e), `edge ${e.fromId} -> ${e.toId} is accepted`);
  }
});

// Fixed in graph-kit: Python imports resolve to scanned files, and calls inside a def become calls edges.
test('an import links the importing file to the file that defines the module', () => {
  assert.ok(hasEdge(first.graph, 'file:pkg/a.py', 'file:pkg/b.py', 'imports'));
});

test('a call inside a function links the caller to the callee', () => {
  assert.ok(hasEdge(first.graph, 'symbol:pkg/a.py#run', 'symbol:pkg/b.py#helper', 'calls'));
});

test('TypeScript files produce symbols (scanned by the TypeScript compiler, no tree-sitter needed)', () => {
  const tsRoot = path.join(root, 'ts');
  writeProject(tsRoot, { 'src/x.ts': 'export function hello(): string { return "hi"; }\n' });
  const { graph } = runGraphKit(tsRoot);
  assert.ok(graph.nodes.some((n) => n.title === 'hello'), 'hello() is a symbol');
});
