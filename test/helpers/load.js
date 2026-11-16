'use strict';
// Loads the userscript into a fresh jsdom window and returns its internals,
// which the script hands over through window.__scdsTestHook.
//
// Each call gets its own window, so tests don't share highlights, timers or
// the shadow host. Call close() when done: the script starts a path-polling
// interval that would otherwise keep the Node process alive.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT_PATH = path.join(ROOT, 'substack-comment-deep-search.user.js');
const SCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8');
const FIXTURES = path.join(__dirname, '..', 'fixtures');

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

const DEFAULT_URL = 'https://www.thebulwark.com/p/some-post/comments';

function load({ html = fixture('synthetic-thread.html'), url = DEFAULT_URL } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  // jsdom does no layout: every rect is zero-sized and scrollIntoView is
  // missing. The script treats a zero-sized button as invisible, so give
  // everything a size unless a test marks it with data-test-invisible.
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.closest('[data-test-invisible]')) {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    }
    return { top: 10, bottom: 30, left: 10, right: 110, width: 100, height: 20 };
  };

  let api = null;
  window.__scdsTestHook = (internals) => { api = internals; };
  window.eval(SCRIPT);
  if (!api) throw new Error('The userscript did not call __scdsTestHook');

  return { dom, window, document: window.document, api, close: () => window.close() };
}

// Appends a comment shaped like the fixture's, the way Load More would.
function addComment(document, { id, author, paragraphs }) {
  const list = document.querySelector('.comment-list-items');
  const anchor = document.createElement('div');
  anchor.className = 'comment-anchor';
  anchor.id = `comment-${id}`;
  const comment = document.createElement('div');
  comment.className = 'comment';
  const content = document.createElement('div');
  content.className = 'comment-content';
  const name = document.createElement('div');
  name.className = 'comment-author-name';
  name.textContent = author;
  const body = document.createElement('div');
  body.className = 'comment-body expanded';
  for (const text of paragraphs) {
    const p = document.createElement('p');
    p.textContent = text;
    body.appendChild(p);
  }
  content.append(name, body);
  comment.appendChild(content);
  list.append(anchor, comment);
  return comment;
}

module.exports = { load, addComment, fixture, SCRIPT, SCRIPT_PATH, DEFAULT_URL };
