// Locates the llm-ide checkout that these tests exercise.
//
// Resolution order: the LLM_IDE_ROOT environment variable, then a sibling
// directory named `llm-ide` next to this repository. Tests import the real
// modules from that checkout, so nothing here is a copy of product code.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** This repository's root (test_llm-ide). */
export const TEST_REPO = path.resolve(here, '..', '..');

function resolveLlmIdeRoot() {
  // LLM_IDE_ROOT wins; otherwise the checkout that contains this repo (when it is
  // the llm-ide submodule), then a sibling named llm-ide.
  const marker = path.join('ui', 'screens', 'gantt', 'gantt-model.ts');
  const candidates = process.env.LLM_IDE_ROOT
    ? [process.env.LLM_IDE_ROOT]
    : [path.resolve(TEST_REPO, '..'), path.resolve(TEST_REPO, '..', 'llm-ide')];
  const root = candidates.map((c) => path.resolve(c)).find((c) => fs.existsSync(path.join(c, marker)));
  if (!root) throw new Error(`no llm-ide checkout found (tried: ${candidates.join(", ")}); set LLM_IDE_ROOT`);
  return root;
}

/** Absolute path of the llm-ide checkout under test. */
export const LLM_IDE = resolveLlmIdeRoot();

/** Import a UI module by its path under ui/screens (TypeScript is stripped by Node). */
export const ui = (relPath) => import(pathToFileURL(path.join(LLM_IDE, 'ui', 'screens', relPath)).href);

/** Import a module by its path under extension/ (the Node core). */
export const ext = (relPath) => import(pathToFileURL(path.join(LLM_IDE, 'extension', relPath)).href);

/** A fresh scratch directory that the test may write into. */
export function scratchDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `test-llm-ide-${label}-`));
}

/** The graph-kit CLI that produces system/graph/graph.json (the graph-kit/ submodule). */
export const GRAPH_KIT_CLI = path.join(LLM_IDE, 'graph-kit', 'bin', 'graph-kit.js');
