'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withScript } = require('./helpers/each');

const marks = (document) => Array.from(document.querySelectorAll('mark.scds-hit'));

test('highlight wraps exactly the matched text, and clear restores the page', withScript(async ({ api, document }) => {
  const c = api.getContainer();
  const before = c.innerHTML;
  const text = c.textContent;

  // Objects built inside the jsdom window have that window's prototypes, so
  // copy them into this realm before a strict deep comparison.
  const result = await api.highlight(c, api.parseQuery('PARAGRAPH').rx);
  assert.deepEqual({ ...result }, { count: 2, timedOut: false });
  assert.deepEqual(marks(document).map((m) => m.textContent), ['paragraph', 'paragraph']);
  assert.equal(api.hits.length, 2);
  assert.equal(c.textContent, text, 'visible text is unchanged by highlighting');

  api.clearHighlights();
  assert.equal(c.innerHTML, before);
  assert.equal(api.hits.length, 0);
  assert.equal(document.querySelector('.comment-body p').childNodes.length, 1, 'text nodes re-merged');
}));

test('highlight marks every match within one text node', withScript(async ({ api, document }) => {
  const p = Array.from(document.querySelectorAll('.comment-body p')).find((el) => el.textContent.includes('$40'));
  const text = p.textContent;
  await api.highlight(api.getContainer(), api.parseQuery('/o/').rx);
  assert.equal(p.querySelectorAll('mark.scds-hit').length, 5);
  assert.equal(p.textContent, text);
}));

test('highlight gives exact spans for a regex with bracket-escaped literals', withScript(async ({ api, document }) => {
  const result = await api.highlight(api.getContainer(), api.parseQuery('/[$]\\d+ [(]\\w+[)]').rx);
  assert.equal(result.count, 1);
  assert.equal(marks(document)[0].textContent, '$40 (forty)');
}));

test('a new highlight replaces the previous one', withScript(async ({ api, document }) => {
  const c = api.getContainer();
  await api.highlight(c, api.parseQuery('paragraph').rx);
  await api.highlight(c, api.parseQuery('tide').rx);
  assert.deepEqual(marks(document).map((m) => m.textContent), ['tide']);
}));

test('zero-length matches are never marked', withScript(async ({ api, document }) => {
  const c = api.getContainer();
  const before = c.innerHTML;
  assert.equal((await api.highlight(c, api.parseQuery('/\\b').rx)).count, 0);
  assert.equal(c.innerHTML, before);
  const mixed = await api.highlight(c, api.parseQuery('/z*').rx);
  assert.equal(mixed.count, 0);
  const some = await api.highlight(c, api.parseQuery('/l*').rx);
  assert.ok(some.count > 0);
  assert.ok(marks(document).every((m) => m.textContent.length > 0));
}));

// F1: the search scope was once the whole container, so "more" hit the Load
// More button and "reply" hit every action row.
test('F1: scope excludes page chrome', withScript(async ({ api, document }) => {
  const c = api.getContainer();
  assert.equal((await api.highlight(c, api.parseQuery('more').rx)).count, 0);
  assert.equal((await api.highlight(c, api.parseQuery('reply').rx)).count, 0);
  assert.equal((await api.highlight(c, api.parseQuery('share').rx)).count, 0);
  assert.equal(api.makeScanner(c, api.parseQuery('more').rx)().found, false);

  const names = await api.highlight(c, api.parseQuery('Ada').rx);
  assert.equal(names.count, 1);
  assert.ok(marks(document)[0].closest('.comment-author-name'));
}));

// F4, from the highlighter's side: it must agree with the scanner.
test('F4: highlighter marks nothing across a paragraph join', withScript(async ({ api }) => {
  const result = await api.highlight(api.getContainer(), api.parseQuery('folks?Trump').rx);
  assert.equal(result.count, 0);
}));

test('focusHit moves the current mark, wraps both ways, and updates the counters', withScript(async ({ api, document }) => {
  await api.highlight(api.getContainer(), api.parseQuery('/o/').rx);
  const n = api.hits.length;
  assert.ok(n > 2);
  const current = () => marks(document).filter((m) => m.classList.contains('scds-current'));
  const count = () => api.shadow.querySelector('.count').textContent;
  const badge = () => api.shadow.querySelector('.badge').textContent;

  api.focusHit(0);
  assert.deepEqual(current(), [api.hits[0]]);
  assert.equal(count(), `1 of ${n}`);
  assert.equal(badge(), `1/${n}`);

  api.focusHit(api.hitIndex - 1);
  assert.equal(api.hitIndex, n - 1, 'Prev on the first match wraps to the last');
  assert.deepEqual(current(), [api.hits[n - 1]]);

  api.focusHit(api.hitIndex + 1);
  assert.equal(api.hitIndex, 0, 'Next on the last match wraps to the first');
  assert.equal(count(), `1 of ${n}`);
}));

// F5: a re-render can detach marks after they were collected.
test('F5: focusHit prunes marks that a re-render detached', withScript(async ({ api, document }) => {
  await api.highlight(api.getContainer(), api.parseQuery('paragraph').rx);
  assert.equal(api.hits.length, 2);
  const body = api.hits[0].closest('.comment-body');
  body.replaceWith(body.cloneNode(false));
  api.focusHit(0);
  assert.equal(api.hits.length, 0);
  assert.equal(api.shadow.querySelector('.badge').hidden, true);
}));

// F14, from the highlighter's side: the same stepping loop is in highlight().
test('F14: highlight gets past an emoji with a pattern that can match empty', withScript(async ({ api, document }) => {
  const p = document.querySelector('.comment-body p');
  p.textContent = `smile ${String.fromCodePoint(0x1F600)} then smile`;
  const result = await api.highlight(api.getContainer(), api.parseQuery('/(smile)?/u').rx);
  assert.equal(result.count, 2);
  assert.deepEqual(marks(document).map((m) => m.textContent), ['smile', 'smile']);
  assert.equal(p.textContent, `smile ${String.fromCodePoint(0x1F600)} then smile`);
}));
