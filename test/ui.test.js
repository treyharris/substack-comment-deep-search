'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withScript } = require('./helpers/each');

// F3: class rules that set display outrank the browser's own [hidden] rule,
// so the attribute was set but the launcher arrows showed anyway.
test('F3: every element carrying [hidden] computes to display: none', withScript(async ({ api, window }) => {
  const display = (el) => window.getComputedStyle(el).display;
  const hidden = () => Array.from(api.shadow.querySelectorAll('[hidden]'));

  assert.ok(hidden().length >= 5, 'arrows, badge, panel, popup and alert start hidden');
  for (const el of hidden()) assert.equal(display(el), 'none', el.className);
  assert.equal(display(api.shadow.querySelector('.lnext')), 'none');

  // And the same elements do show once the attribute is removed.
  await api.highlight(api.getContainer(), api.parseQuery('paragraph').rx);
  api.focusHit(0);
  for (const sel of ['.lnext', '.lprev', '.badge']) {
    const el = api.shadow.querySelector(sel);
    assert.equal(el.hidden, false, sel);
    assert.notEqual(display(el), 'none', sel);
  }
  for (const el of hidden()) assert.equal(display(el), 'none', el.className);
}));

test('the widget starts as the launcher, with the version hint in the status line', withScript(({ api }) => {
  assert.equal(api.mode, 'launcher');
  assert.equal(api.shadow.querySelector('.launcher').hidden, false);
  assert.equal(api.shadow.querySelector('.panel').hidden, true);
  assert.equal(api.shadow.querySelector('.status').textContent, api.HINT);
}));

test('the widget is hidden off comment pages', withScript(
  { url: 'https://www.thebulwark.com/p/some-post' },
  ({ api }) => {
    assert.equal(api.host.style.display, 'none');
  }
));

test('a second copy of the script does not render a second widget', withScript(({ window, document, api }) => {
  let second = null;
  window.__scdsTestHook = (x) => { second = x; };
  window.eval(require('./helpers/load').SCRIPT);
  assert.equal(second, null, 'the second copy returned at the HOST_ID guard');
  assert.equal(document.querySelectorAll(`#${api.HOST_ID}`).length, 1);
}));
