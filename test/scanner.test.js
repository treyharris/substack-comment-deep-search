'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withScript } = require('./helpers/each');
const { addComment } = require('./helpers/load');

test('matchesNode steps over zero-length matches', withScript(({ api }) => {
  assert.equal(api.matchesNode(/\b/g, 'some words'), false);
  assert.equal(api.matchesNode(/x*/g, 'abc'), false);
  assert.equal(api.matchesNode(/x*/g, 'abxc'), true, 'non-empty match after empty ones');
  assert.equal(api.matchesNode(/c$/g, 'abc'), true);
}));

// F14: with the u or v flag, exec moves a lastIndex that falls inside a
// surrogate pair back to the start of the pair, so stepping past an empty
// match one code unit at a time never got past an emoji. A synchronous
// infinite loop can't be timed out in-process, so a regression here hangs
// the suite rather than failing it.
const EMOJI = String.fromCodePoint(0x1F600);
test('F14: zero-length stepping gets past astral characters under u and v', withScript(({ api }) => {
  assert.equal(api.matchesNode(/x*/gu, `ok ${EMOJI} then`), false);
  assert.equal(api.matchesNode(/x*/gv, `ok ${EMOJI} then`), false);
  assert.equal(api.matchesNode(/x*/gu, `ok ${EMOJI} thxen`), true);
  assert.equal(api.matchesNode(/x*/gu, `${EMOJI}${EMOJI}`), false, 'adjacent pairs, at the start');
  assert.equal(api.matchesNode(/x*/gu, `ab${EMOJI}`), false, 'pair at the end');
  assert.equal(api.matchesNode(/x*/g, `ok ${EMOJI} then`), false, 'without u, stepping by code unit is fine');
}));

test('matchesNode starts from the beginning whatever lastIndex was', withScript(({ api }) => {
  const rx = /abc/g;
  rx.lastIndex = 5;
  assert.equal(api.matchesNode(rx, 'abc def'), true);
}));

test('scanner finds text in bodies and in author names', withScript(({ api }) => {
  const c = api.getContainer();
  assert.equal(api.makeScanner(c, api.parseQuery('tide tables').rx)().found, true);
  assert.equal(api.makeScanner(c, api.parseQuery('ines marlow').rx)().found, true);
  assert.equal(api.makeScanner(c, api.parseQuery('absent-term').rx)().found, false);
}));

// F4: the scanner once tested element.textContent, which joins sibling <p>s
// with no separator and so matched text the highlighter could never mark.
test('F4: no match across a paragraph join', withScript(({ api, document }) => {
  const c = api.getContainer();
  const joined = Array.from(document.querySelectorAll('.comment-body'))
    .some((b) => b.textContent.includes('folks?Trump'));
  assert.ok(joined, 'fixture must contain the join, or this test proves nothing');

  assert.equal(api.makeScanner(c, api.parseQuery('folks?Trump').rx)().found, false);
  assert.equal(api.makeScanner(c, api.parseQuery('/folks.\\s*Tr/s').rx)().found, false);
  assert.equal(api.makeScanner(c, api.parseQuery('folks?').rx)().found, true);
}));

// F12: each pass must read only what arrived since the last one.
test('F12: scanner is incremental', withScript(({ api, document }) => {
  const c = api.getContainer();
  const walked = [];
  const original = document.createTreeWalker.bind(document);
  document.createTreeWalker = (root, ...rest) => {
    walked.push(root);
    return original(root, ...rest);
  };

  const scan = api.makeScanner(c, api.parseQuery('absent-term').rx);
  assert.equal(scan().found, false);
  assert.equal(walked.length, 6, 'three names and three bodies');

  walked.length = 0;
  const a = addComment(document, { id: 201, author: 'New One', paragraphs: ['Fresh text.'] });
  const b = addComment(document, { id: 202, author: 'New Two', paragraphs: ['More fresh text.'] });
  assert.equal(scan().found, false);
  assert.equal(walked.length, 4, 'only the two new comments');
  assert.ok(walked.every((root) => a.contains(root) || b.contains(root)));

  walked.length = 0;
  assert.equal(scan().found, false);
  assert.equal(walked.length, 0, 'nothing new, nothing read');
}));

test('scanner sees a match that arrives in a later load', withScript(({ api, document }) => {
  const scan = api.makeScanner(api.getContainer(), api.parseQuery('needle').rx);
  assert.equal(scan().found, false);
  addComment(document, { id: 301, author: 'Someone', paragraphs: ['No luck.', 'Here is the needle.'] });
  assert.equal(scan().found, true);
  assert.equal(scan().found, true, 'a found match stays found on the next pass');
}));

test('scanner starts over when the list shrinks', withScript(({ api, document }) => {
  const scan = api.makeScanner(api.getContainer(), api.parseQuery('Lighthouse').rx);
  // Consume everything with the match hidden, then shrink the list.
  const body = document.querySelector('.comment-body p');
  body.textContent = 'The first paragraph mentions nothing.';
  assert.equal(scan().found, false);
  body.textContent = 'The first paragraph mentions Lighthouse keepers.';
  assert.equal(scan().found, false, 'already read, so not re-read');
  document.querySelectorAll('.comment')[2].remove();
  assert.equal(scan().found, true, 'shrink resets the index');
}));
