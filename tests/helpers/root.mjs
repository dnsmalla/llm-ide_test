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
  const raw = process.env.LLM_IDE_ROOT || path.resolve(TEST_REPO, '..', 'llm-ide');
  const root = path.resolve(raw);
  if (!fs.existsSync(path.join(root, 'ui', 'screens', 'gantt', 'gantt-model.ts'))) {
    throw new Error(`LLM_IDE_ROOT does not point at an llm-ide checkout: ${root}`);
  }
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
