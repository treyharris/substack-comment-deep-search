'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withScript } = require('./helpers/each');

test('escapeRe neutralizes every regex metacharacter', withScript(({ api }) => {
  const literal = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
  const rx = new RegExp('^' + api.escapeRe(literal) + '$');
  assert.ok(rx.test(literal));
  assert.ok(!new RegExp('^' + api.escapeRe('a.b') + '$').test('axb'));
}));

test('parseQuery: empty input is an error', withScript(({ api }) => {
  assert.equal(api.parseQuery('').error, 'Enter a search term.');
  assert.equal(api.parseQuery('   ').error, 'Enter a search term.');
}));

test('parseQuery: plain text is literal and case-insensitive', withScript(({ api }) => {
  const q = api.parseQuery('  $40 (forty)  ');
  assert.equal(q.regex, false);
  assert.equal(q.rx.flags, 'gi');
  assert.ok(q.rx.test('it cost $40 (FORTY) then'));
  q.rx.lastIndex = 0;
  assert.ok(!q.rx.test('it cost 40 forty'));
}));

test('parseQuery: a leading slash is regex mode, case-sensitive, terminator optional', withScript(({ api }) => {
  const open = api.parseQuery('/fo+');
  assert.equal(open.regex, true);
  assert.equal(open.rx.source, 'fo+');
  assert.equal(open.rx.flags, 'g');
  const closed = api.parseQuery('/fo+/');
  assert.equal(closed.rx.source, 'fo+');
  assert.equal(closed.rx.flags, 'g');
}));

test('parseQuery: flags are applied as typed, and g is accepted but ignored', withScript(({ api }) => {
  assert.equal(api.parseQuery('/foo/i').rx.flags, 'gi');
  assert.equal(api.parseQuery('/foo/g').rx.flags, 'g');
  const all = api.parseQuery('/foo/imsu').rx;
  assert.ok(all.ignoreCase && all.multiline && all.dotAll && all.unicode);
  assert.equal(api.parseQuery('/foo').rx.unicode, false, 'no implicit u');
}));

test('parseQuery: unknown flag letters are an error, not pattern text', withScript(({ api }) => {
  assert.match(api.parseQuery('/foo/x').error, /^Unknown flag "x"/);
  assert.match(api.parseQuery('/foo/xy').error, /^Unknown flags "xy"/);
  assert.match(api.parseQuery('/foo/iy').error, /^Unknown flag "y"/);
}));

test('parseQuery: the last slash terminates only when followed by letters alone', withScript(({ api }) => {
  const q = api.parseQuery('/A[/]B');
  assert.equal(q.rx.source, 'A[/]B');
  assert.ok(q.rx.test('A/B'));
  assert.equal(api.parseQuery('/A[/]B/i').rx.flags, 'gi');
}));

test('parseQuery: empty and invalid patterns are errors', withScript(({ api }) => {
  assert.equal(api.parseQuery('/').error, 'Empty pattern.');
  assert.equal(api.parseQuery('//').error, 'Empty pattern.');
  assert.match(api.parseQuery('/(unclosed').error, /^Invalid pattern/);
  assert.match(api.parseQuery('/foo/uv').error, /^Invalid pattern/, 'u and v together');
}));
