'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withScript } = require('./helpers/each');
const { fixture } = require('./helpers/load');

const base = fixture('synthetic-thread.html');
// Each variant must actually change the markup, or its test is vacuous.
function variant(...edits) {
  let html = base;
  for (const [from, to] of edits) {
    assert.ok(html.includes(from), `fixture no longer contains ${from}`);
    html = html.replaceAll(from, to);
  }
  return html;
}

test('findLoadMore finds the button by its text, not its classes', withScript(({ api, document }) => {
  const c = api.getContainer();
  const btn = api.findLoadMore(c);
  assert.equal(btn.textContent, 'Load More');
  btn.className = 'something-else-entirely';
  assert.equal(api.findLoadMore(c), btn);
  btn.remove();
  assert.equal(api.findLoadMore(c), null, 'LIKE / REPLY / SHARE are not Load More');
}));

test('findLoadMore accepts the known text variants and role=button', withScript(({ api, document }) => {
  const c = api.getContainer();
  const btn = api.findLoadMore(c);
  for (const text of ['load more', '  Load More  ', 'LOAD MORE', 'Show more', 'More comments']) {
    btn.textContent = text;
    assert.equal(api.findLoadMore(c), btn, text);
  }
  for (const text of ['Read more', 'Reload', 'Load More comments', '12 more replies', '194 more replies']) {
    btn.textContent = text;
    assert.equal(api.findLoadMore(c), null, text);
  }
  const div = document.createElement('div');
  div.setAttribute('role', 'button');
  div.textContent = 'Load More';
  btn.replaceWith(div);
  assert.equal(api.findLoadMore(c), div);
}));

// The "More from the ... chat" block that Substack renders at the foot of a
// comments page, inside .comments-page. Its classes are hash-suffixed, as
// observed; the fix must not depend on them.
function addChatSection(document, label) {
  const section = document.createElement('div');
  section.className = 'thread-SxUlwu';
  section.innerHTML =
    '<h4>More from the The Bulwark chat</h4>' +
    '<div class="post">Let\u2019s discuss: something.</div>' +
    '<div class="replies-LmIItY"><button class="moreReplies-xVy3wc"></button></div>';
  const button = section.querySelector('button');
  button.textContent = label;
  let clicked = 0;
  button.addEventListener('click', () => { clicked++; });
  document.querySelector('.comments-page').appendChild(section);
  return { button, clicks: () => clicked };
}

// F13: with the real Load More gone, the next match down the page was the
// chat block's "194 more replies", whose handler opens the chat.
test('F13: a "N more replies" button in the chat block is never chosen', withScript(({ api, document }) => {
  const c = api.getContainer();
  const chat = addChatSection(document, '194 more replies');
  const real = api.findLoadMore(c);
  assert.equal(real.textContent, 'Load More');
  real.remove();
  assert.equal(api.findLoadMore(c), null);
  assert.equal(chat.clicks(), 0);
}));

test('F13: a Load More-labelled button outside the comment list is never chosen', withScript(({ api, document }) => {
  const c = api.getContainer();
  addChatSection(document, 'Load More');
  const real = api.findLoadMore(c);
  assert.equal(real.parentElement, document.querySelector('.comments-page'));
  real.remove();
  assert.equal(api.findLoadMore(c), null, 'label matches, position does not');
}));

test('F13: with comment selectors drifted, the label alone decides', withScript(
  { html: variant(['class="comment"', 'class="comment-NOPE"']) },
  ({ api, document }) => {
    const c = api.getContainer();
    addChatSection(document, '194 more replies');
    assert.equal(api.findLoadMore(c).textContent, 'Load More');
  }
));

test('findLoadMore ignores a button with no size', withScript(({ api }) => {
  const c = api.getContainer();
  api.findLoadMore(c).setAttribute('data-test-invisible', '');
  assert.equal(api.findLoadMore(c), null);
}));

test('getContainer prefers .comments-page and falls back to the body', withScript(({ api, document }) => {
  assert.ok(api.getContainer().matches('.comments-page'));
  document.querySelector('.comments-page').className = '';
  assert.ok(api.getContainer().matches('.dt-comments'));
  document.querySelector('.dt-comments').className = '';
  assert.equal(api.getContainer(), document.body);
}));

test('diagnose: a healthy thread has no problems', withScript(({ api }) => {
  const d = api.diagnose();
  assert.equal(d.problems.length, 0, d.problems.join(' | '));
  assert.equal(d.hydrated, true);
  assert.deepEqual({ ...d.counts }, { comments: 3, corroborated: 6, bodies: 3, names: 3, withBody: 3 });
}));

test('diagnose: an empty page is silent and not hydrated', withScript(
  { html: '<!doctype html><body><div class="comments-page"></div></body>' },
  ({ api }) => {
    const d = api.diagnose();
    assert.equal(d.problems.length, 0, d.problems.join(' | '));
    assert.equal(d.hydrated, false);
  }
));

test('diagnose: comment selector renamed', withScript(
  { html: variant(['class="comment"', 'class="comment-NOPE"']) },
  ({ api }) => {
    const d = api.diagnose();
    assert.equal(d.problems.length, 1);
    assert.match(d.problems[0], /^[.]comment matched nothing, but 6 comment markers are present/);
    assert.equal(d.hydrated, true);
  }
));

test('diagnose: body selector renamed', withScript(
  { html: variant(['comment-body expanded', 'comment-body-NOPE expanded']) },
  ({ api }) => {
    const d = api.diagnose();
    assert.equal(d.problems.length, 1);
    assert.match(d.problems[0], /^[.]comment-body matched nothing across 3 comments/);
  }
));

test('diagnose: author-name selector renamed', withScript(
  { html: variant(['comment-author-name', 'comment-author-NOPE']) },
  ({ api }) => {
    const d = api.diagnose();
    assert.equal(d.problems.length, 1);
    assert.match(d.problems[0], /^[.]comment-author-name matched nothing/);
  }
));

test('diagnose: container selectors all renamed', withScript(
  { html: variant(['class="comments-page"', 'class="x-page"'], ['class="dt-comments"', 'class="x-comments"']) },
  ({ api }) => {
    const d = api.diagnose();
    assert.equal(d.problems.length, 1);
    assert.match(d.problems[0], /^No comments container matched/);
  }
));

test('diagnose: bodies exist but not inside comments', withScript(({ api, document }) => {
  document.querySelectorAll('.comment-body').forEach((b) => document.querySelector('.comments-page').appendChild(b));
  const d = api.diagnose();
  assert.equal(d.problems.length, 1);
  assert.match(d.problems[0], /the nesting has changed/);
}));

// Issue #3, an accepted gap. This test records the current behavior so a
// change to it is deliberate; it does not assert that the behavior is good.
test('diagnose: known gap, everything renamed at once is silent', withScript(
  { html: variant(['class="comment"', 'class="c-NOPE"'], ['id="comment-', 'id="c-']) },
  ({ api }) => {
    const d = api.diagnose();
    assert.equal(d.problems.length, 0, d.problems.join(' | '));
    assert.equal(d.hydrated, false);
  }
));

test('a dead corroborator alone is not a problem', withScript(
  { html: variant(['id="comment-', 'id="c-']) },
  ({ api }) => {
    assert.equal(api.diagnose().problems.length, 0);
  }
));

test('isCommentPage gates by path alone', withScript(({ api, dom }) => {
  const at = (url) => { dom.reconfigure({ url }); return api.isCommentPage(); };
  const origin = 'https://www.thebulwark.com';
  for (const path of [
    '/p/some-post/comments',
    '/p/some-post/comments/',
    '/p/some-post/comment/123456',
    '/p/some-post/comment/123456/',
    '/p/some-post/comments?utm_source=x',
    '/p/some-post/comments#comment-9',
  ]) assert.equal(at(origin + path), true, path);
  for (const path of [
    '/',
    '/p/some-post',
    '/p/some-post/',
    '/p/some-post/comments/extra',
    '/p/some-post/comment/abc',
    '/p/some-post/comment',
    '/p/a/b/comments',
    '/archive/p/some-post/comments',
  ]) assert.equal(at(origin + path), false, path);
}));
