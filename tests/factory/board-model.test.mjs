// Factory board model: which actions a card offers, where it sits in a lane,
// the header summary and the guard on links the board opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ui } from '../helpers/root.mjs';

const board = await ui('factory/board-model.ts');
const columns = await ui('factory/columns.ts');
const { NOTE, COLUMNS } = columns;

test('the board has the expected columns in order', () => {
  assert.deepEqual([...COLUMNS], ['inbox', 'needsDecision', 'working', 'needsYou', 'readyToShip', 'shipped', 'done']);
});

test('an inbox card with a ready intake offers Start and Discard, not Intake', () => {
  assert.deepEqual(board.actionsFor('inbox', NOTE.intakeReady), ['start', 'discard']);
});

test('an inbox card with no intake yet offers Intake', () => {
  assert.deepEqual(board.actionsFor('inbox', null), ['start', 'intake', 'discard']);
});

test('a process without an Intake step never offers Intake', () => {
  assert.equal(board.actionsFor('inbox', null, { intake: false }).includes('intake'), false);
});

test('a card that is working offers no actions', () => {
  assert.deepEqual(board.actionsFor('working', null), []);
});

test('a failed CI card offers Send back and opens the request', () => {
  assert.deepEqual(board.actionsFor('needsYou', NOTE.ciFailed), ['sendBack', 'openRequest', 'openDiff', 'discard']);
});

test('an interrupted run offers Finish checks rather than a full rerun first', () => {
  assert.equal(board.actionsFor('needsYou', NOTE.interrupted)[0], 'finishChecks');
});

test('a ready-to-ship card offers Ship', () => {
  assert.ok(board.actionsFor('readyToShip', null).includes('ship'));
});

test('cardTone maps every status family to a colour family', () => {
  assert.equal(board.cardTone('Working'), 'run');
  assert.equal(board.cardTone('Needs you'), 'alert');
  assert.equal(board.cardTone('Needs decision'), 'warn');
  assert.equal(board.cardTone('Shipped'), 'ok');
  assert.equal(board.cardTone('Open issue'), 'ghost');
  assert.equal(board.cardTone('something new'), 'idle');
});

test('boardSummary names every count and pluralises "need" correctly', () => {
  const card = (status) => ({ key: status, title: 't', status, note: null, lane: 'x', actions: [] });
  const lanes = [
    { id: 'backlog', cards: [card('Open issue'), card('Open issue')] },
    { id: 'done', cards: [card('Done')] },
    { id: 'step:verify', cards: [card('Needs you')] },
  ];
  assert.equal(board.boardSummary(lanes, 2), '2 in backlog · 2 running · 1 needs you · 1 waiting to merge');
  const two = [...lanes, { id: 'step:review', cards: [card('Needs decision')] }];
  // The product's English: "1 needs you", "2 need you" (the singular verb only for one).
  assert.match(board.boardSummary(two, 0), /2 need you/);
});

test('markerStage reads the stage from a JSON marker and rejects anything else', () => {
  assert.equal(board.markerStage('{"stage":"Verify"}'), 'Verify');
  assert.equal(board.markerStage('{"stage":"   "}'), null);
  assert.equal(board.markerStage('not json'), null);
  assert.equal(board.markerStage(null), null);
  assert.equal(board.markerStage(JSON.stringify({ stage: 'x'.repeat(500) })).length, 120, 'a stage name is capped');
});

test('safeRequestUrl only opens https links on GitHub or GitLab', () => {
  assert.equal(board.safeRequestUrl('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1');
  assert.equal(board.safeRequestUrl('https://gitlab.com/g/p/-/merge_requests/1'), 'https://gitlab.com/g/p/-/merge_requests/1');
  assert.equal(board.safeRequestUrl('http://github.com/o/r'), null, 'plain http is refused');
  assert.equal(board.safeRequestUrl('https://evil.example/x'), null);
  assert.equal(board.safeRequestUrl('javascript:alert(1)'), null);
  assert.equal(board.safeRequestUrl(null), null);
});

test('openIssueCard is a Backlog card whose only action is Start', () => {
  const card = board.openIssueCard({ key: 'github:o/r#5', title: 'Add export' });
  assert.equal(card.lane, board.LANE_BACKLOG);
  assert.equal(card.status, 'Open issue');
  assert.deepEqual(card.actions, ['start']);
});

test('buildBoard puts items with no facts in Inbox, keeping insertion order', () => {
  const items = [
    { key: 'a', title: 'First', source: 'issue' },
    { key: 'b', title: 'Second', source: 'issue' },
  ];
  const out = board.buildBoard(items, new Map(), 0);
  assert.deepEqual(out.inbox.map((c) => c.key), ['a', 'b']);
  for (const col of COLUMNS.filter((c) => c !== 'inbox')) assert.equal(out[col].length, 0, col);
});
