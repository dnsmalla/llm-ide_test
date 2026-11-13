// The Factory process template (system/factory-template.json): parsing,
// validation with line numbers, round-trip formatting and the line diff used
// by "Reset to default". Pure functions from ui/screens/loop/native.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ui } from '../helpers/root.mjs';

const tpl = await ui('loop/native/factory-template.ts');

const base = () => JSON.parse(JSON.stringify(tpl.defaultFactoryTemplate()));
const asText = (obj) => JSON.stringify(obj, null, 2);

test('the default template survives format, then parse, unchanged', () => {
  const text = tpl.formatFactoryTemplate(tpl.defaultFactoryTemplate());
  const parsed = tpl.parseFactoryTemplate(text);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.equal(tpl.formatFactoryTemplate(parsed.template), text);
});

test('invalid JSON is reported with the line it failed on', () => {
  const parsed = tpl.parseFactoryTemplate('{\n  "version": 1,\n  "stages": [\n');
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors[0].line >= 1);
  assert.match(parsed.errors[0].message, /not valid JSON/);
});

test('a template without the reviewGate step is refused', () => {
  const t = base();
  t.stages = t.stages.filter((s) => s.role !== 'reviewGate');
  const parsed = tpl.parseFactoryTemplate(asText(t));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.length > 0);
});

test('a custom verdict file outside .factory/ is refused', () => {
  const t = base();
  t.stages.push({ role: 'custom', name: 'Escape', kind: 'artifactCheck', verdictPath: '../etc/passwd', verdictLine: 'Verdict: ok' });
  const parsed = tpl.parseFactoryTemplate(asText(t));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some((e) => /\.factory/.test(e.message)), JSON.stringify(parsed.errors));
});

test('a custom verdict file may not reuse the Factory gate report', () => {
  const t = base();
  t.stages.push({ role: 'custom', name: 'Shadow', kind: 'artifactCheck', verdictPath: '.factory/REVIEW.md', verdictLine: 'Verdict: approve' });
  const parsed = tpl.parseFactoryTemplate(asText(t));
  assert.equal(parsed.ok, false);
});

test('a custom skill step cannot sit between Review and the Review gate', () => {
  const t = base();
  const reviewAt = t.stages.findIndex((s) => s.role === 'review');
  t.stages.splice(reviewAt + 1, 0, { role: 'custom', name: 'Sneak', kind: 'skill', skill: 'writing-plans', prompt: 'x' });
  const parsed = tpl.parseFactoryTemplate(asText(t));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some((e) => /between/.test(e.message)));
});

test('two steps with the same name are refused', () => {
  const t = base();
  t.stages[0].name = 'Same step';
  t.stages[1].name = 'same STEP'; // names compare case-insensitively
  const parsed = tpl.parseFactoryTemplate(asText(t));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some((e) => /used twice/.test(e.message)));
});

test('lineDiff marks unchanged, removed and added lines', () => {
  const diff = tpl.lineDiff('a\nb\nc', 'a\nX\nc');
  assert.deepEqual(diff, [
    { kind: ' ', text: 'a' },
    { kind: '-', text: 'b' },
    { kind: '+', text: 'X' },
    { kind: ' ', text: 'c' },
  ]);
});

test('lineDiff of identical text has no changes', () => {
  assert.ok(tpl.lineDiff('same\ntext', 'same\ntext').every((l) => l.kind === ' '));
});

test('lineStart gives the offset of a 1-based line', () => {
  const text = 'one\ntwo\nthree';
  assert.equal(tpl.lineStart(text, 1), 0);
  assert.equal(tpl.lineStart(text, 2), 4);
  assert.equal(tpl.lineStart(text, 3), 8);
  assert.equal(tpl.lineStart(text, 99), text.length, 'past the end lands at the end');
});

test('formatFactoryTemplate writes version 1 and a trailing newline', () => {
  const text = tpl.formatFactoryTemplate(tpl.defaultFactoryTemplate());
  assert.equal(JSON.parse(text).version, 1);
  assert.ok(text.endsWith('\n'));
});
