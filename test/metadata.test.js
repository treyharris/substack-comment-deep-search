'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SCRIPT } = require('./helpers/load');
const { withScript } = require('./helpers/each');

// Reads the ==UserScript== block into { key: [values] }.
function metadata(source) {
  const start = source.indexOf('// ==UserScript==');
  const end = source.indexOf('// ==/UserScript==');
  assert.ok(start === 0 && end > start, 'metadata block must open the file');
  const out = {};
  for (const line of source.slice(start, end).split('\n').slice(1)) {
    const m = /^[/][/] @(\S+)\s+(.*\S)\s*$/.exec(line);
    if (m) (out[m[1]] = out[m[1]] || []).push(m[2]);
  }
  return out;
}

const meta = metadata(SCRIPT);

// Issue #29: the status-line version is what gets checked to rule out a stale
// cached copy, so it has to agree with the version managers compare.
test('@version and the HINT constant carry the same version', withScript(({ api }) => {
  const [version] = meta.version;
  assert.match(version, /^\d+[.]\d+([.]\d+)?$/);
  assert.ok(api.HINT.startsWith(`v${version} `), `HINT is "${api.HINT}", @version is ${version}`);
}));

// Identity is @namespace + @name. Changing either makes a different script
// that installed copies will never update into.
test('script identity is unchanged', () => {
  assert.deepEqual(meta.name, ['Substack Comment Deep Search']);
  assert.deepEqual(meta.namespace, ['https://github.com/treyharris']);
});

test('update metadata is complete and consistent', () => {
  assert.equal(meta.updateURL.length, 1);
  assert.deepEqual(meta.updateURL, meta.downloadURL);
  assert.ok(meta.updateURL[0].startsWith('https://'));
  assert.ok(meta.updateURL[0].endsWith('.user.js'), 'managers key on the .user.js suffix');
  assert.deepEqual(meta.grant, ['none']);
  assert.deepEqual(meta['run-at'], ['document-idle']);
});

test('the script matches The Bulwark and Substack', () => {
  assert.deepEqual(meta.match, [
    'https://www.thebulwark.com/*',
    'https://thebulwark.com/*',
    'https://*.substack.com/*',
  ]);
});
