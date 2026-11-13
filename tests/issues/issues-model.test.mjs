// Issues model: decoding the core's /kb/issues body, filtering, repo slugs,
// open-URL safety, due-date display and the create-form idempotency key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ui } from '../helpers/root.mjs';

const model = await ui('issues/issues-model.ts');

const issue = (over = {}) => ({
  id: '1', title: 'Fix login', body: '', url: '', provider: 'github', repo: 'octo/repo',
  number: 1, state: 'open', labels: [], author: null, createdAt: null, updatedAt: null,
  isPR: false, milestone: null, assignees: [], ...over,
});
const filters = (over = {}) => ({ query: '', provider: '', state: 'all', repo: '', repoExact: false, label: '', ...over });

test('decodeIssues strips a leading "#N" that repeats the issue number', () => {
  const out = model.decodeIssues({ issues: [{ number: 7, title: '#7 Fix login', state: 'open', labels: [] }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Fix login');
  assert.equal(out[0].number, 7);
});

test('decodeIssues drops rows without a title and non-object rows', () => {
  const out = model.decodeIssues({ issues: [{ number: 1, title: '' }, 'junk', { number: 2, title: 'Keep me' }] });
  assert.deepEqual(out.map((i) => i.title), ['Keep me']);
});

test('decodeIssues returns an empty list for a body without issues', () => {
  assert.deepEqual(model.decodeIssues(null), []);
  assert.deepEqual(model.decodeIssues({}), []);
});

test('filterIssues never shows pull requests', () => {
  const out = model.filterIssues([issue({ number: 1 }), issue({ number: 2, isPR: true })], filters());
  assert.deepEqual(out.map((i) => i.number), [1]);
});

test('filterIssues filters by state', () => {
  const list = [issue({ number: 1, state: 'open' }), issue({ number: 2, state: 'closed' })];
  assert.deepEqual(model.filterIssues(list, filters({ state: 'closed' })).map((i) => i.number), [2]);
  assert.equal(model.filterIssues(list, filters()).length, 2);
});

test('filterIssues matches labels case-insensitively', () => {
  const list = [issue({ number: 1, labels: ['Priority: High'] }), issue({ number: 2, labels: ['bug'] })];
  assert.deepEqual(model.filterIssues(list, filters({ label: 'priority: high' })).map((i) => i.number), [1]);
});

test('filterIssues text query searches title, body, labels, #number and repo', () => {
  const list = [
    issue({ number: 1, title: 'Login broken' }),
    issue({ number: 42, title: 'Other', body: 'the checkout page' }),
  ];
  assert.deepEqual(model.filterIssues(list, filters({ query: 'login' })).map((i) => i.number), [1]);
  assert.deepEqual(model.filterIssues(list, filters({ query: 'checkout' })).map((i) => i.number), [42]);
  assert.deepEqual(model.filterIssues(list, filters({ query: '#42' })).map((i) => i.number), [42]);
});

test('repoMatches: exact mode is case-sensitive, substring mode is not', () => {
  assert.equal(model.repoMatches('Octo/Repo', 'octo/repo', true), false);
  assert.equal(model.repoMatches('Octo/Repo', 'octo', false), true);
});

test('repoSlug reads https, scp-style and page-suffixed URLs', () => {
  assert.equal(model.repoSlug('https://github.com/octo/repo.git'), 'octo/repo');
  assert.equal(model.repoSlug('git@gitlab.com:grid-devs/personal/dinesh/test.git'), 'grid-devs/personal/dinesh/test');
  assert.equal(model.repoSlug('https://gitlab.com/grp/proj/-/tree/main'), 'grp/proj');
});

test('repoSlug drops credentials from a URL', () => {
  assert.equal(model.repoSlug('https://user:secret@gitlab.com/grp/proj.git'), 'grp/proj');
});

test('issueOpenUrl only returns links on the expected origin', () => {
  assert.equal(
    model.issueOpenUrl({ url: 'https://github.com/octo/repo/issues/1', provider: 'github' }, null),
    'https://github.com/octo/repo/issues/1',
  );
  assert.equal(model.issueOpenUrl({ url: 'https://evil.example/x', provider: 'github' }, null), '');
  assert.equal(model.issueOpenUrl({ url: 'https://gitlab.com/g/p/-/issues/1', provider: 'gitlab' }, null), '', 'no GitLab origin known');
  assert.equal(
    model.issueOpenUrl({ url: 'https://gitlab.com/g/p/-/issues/1', provider: 'gitlab' }, 'https://gitlab.com'),
    'https://gitlab.com/g/p/-/issues/1',
  );
  assert.equal(model.issueOpenUrl({ url: 'https://user:pw@github.com/o/r', provider: 'github' }, null), '', 'credentials are refused');
});

test('formatDueDate shows a bare day in the short form and blanks bad input', () => {
  assert.equal(model.formatDueDate('2026-11-30'), 'Nov 30, 2026');
  assert.equal(model.formatDueDate(null), '');
  assert.equal(model.formatDueDate('not a date'), '');
});

test('overlayRepoSupported: GitHub is owner/name, GitLab allows nested groups', () => {
  assert.equal(model.overlayRepoSupported('octo/repo', 'github'), true);
  assert.equal(model.overlayRepoSupported('octo/repo/extra', 'github'), false);
  assert.equal(model.overlayRepoSupported('grp/sub/proj', 'gitlab'), true);
  assert.equal(model.overlayRepoSupported('octo/../repo', 'github'), false, 'dot segments are refused');
  assert.equal(model.overlayRepoSupported('octo/repo', 'bitbucket'), false);
});

test('createFingerprint ignores surrounding whitespace in the title', () => {
  assert.equal(
    model.createFingerprint('github', 'o/r', '  Title ', 'body'),
    model.createFingerprint('github', 'o/r', 'Title', 'body'),
  );
  assert.notEqual(
    model.createFingerprint('github', 'o/r', 'Title', 'body'),
    model.createFingerprint('github', 'o/r', 'Title', 'other body'),
  );
});

test('idemKeyFor reuses the key for the same content and mints a new one for edited content', () => {
  let minted = 0;
  const mint = () => `key-${++minted}`;
  const first = model.idemKeyFor(null, 'fp-a', mint);
  assert.equal(first.key, 'key-1');
  const retry = model.idemKeyFor(first, 'fp-a', mint);
  assert.equal(retry.key, 'key-1', 'a retry of the same content keeps its key');
  const edited = model.idemKeyFor(first, 'fp-b', mint);
  assert.equal(edited.key, 'key-2', 'edited content must not replay the old key');
});

test('labelNamespace picks the namespace most issues share', () => {
  const list = [
    issue({ number: 1, labels: ['status: todo'] }),
    issue({ number: 2, labels: ['status: doing'] }),
    issue({ number: 3, labels: ['bug'] }),
  ];
  assert.equal(model.labelNamespace(list), 'status');
  assert.equal(model.labelValue('status: todo', 'status'), 'todo');
  assert.equal(model.labelValue('bug', 'status'), null);
});
