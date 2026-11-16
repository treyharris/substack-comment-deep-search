'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withScript } = require('./helpers/each');

// Event shapes. On macOS, Option composes: Option+Shift+F emits key "Ï", and
// adding Control suppresses that and emits "F". code is the physical key
// position, which on Dvorak is KeyY for the F key.
const mods = { altKey: true, shiftKey: true };
const DVORAK_F = { ...mods, key: 'Ï', code: 'KeyY' };
const DVORAK_F_CTRL = { ...mods, ctrlKey: true, key: 'F', code: 'KeyY' };
const QWERTY_F = { ...mods, key: 'Ï', code: 'KeyF' };
const QWERTY_F_CTRL = { ...mods, ctrlKey: true, key: 'F', code: 'KeyF' };

// F11: the chord never worked. e.key === 'F' missed the composed character;
// e.code === 'KeyF' missed Dvorak's F and fired on the key at QWERTY's F
// position instead.
test('F11: the chord matches on Dvorak and QWERTY, with and without Control', withScript(({ api }) => {
  for (const [name, e] of Object.entries({ DVORAK_F, DVORAK_F_CTRL, QWERTY_F, QWERTY_F_CTRL })) {
    assert.equal(api.isToggleChord(e), true, name);
  }
  assert.equal(api.isToggleChord({ ...mods, key: 'f', code: 'KeyY' }), true, 'lowercase f');
}));

test('F11: a usable key that is not F never matches, whatever its position', withScript(({ api }) => {
  // The key at QWERTY's F position on Dvorak is U. This shape is constructed,
  // not captured from a device; see issue #5 for the snippet to capture one.
  assert.equal(api.isToggleChord({ ...mods, ctrlKey: true, key: 'U', code: 'KeyF' }), false);
  assert.equal(api.isToggleChord({ ...mods, key: '¨', code: 'KeyF' }), false);
  assert.equal(api.isToggleChord({ ...mods, key: 'Y', code: 'KeyF' }), false);
}));

test('the chord needs both Option and Shift', withScript(({ api }) => {
  assert.equal(api.isToggleChord({ key: 'f', code: 'KeyF' }), false);
  assert.equal(api.isToggleChord({ altKey: true, key: 'f', code: 'KeyF' }), false);
  assert.equal(api.isToggleChord({ shiftKey: true, key: 'F', code: 'KeyF' }), false);
  assert.equal(api.isToggleChord({ ctrlKey: true, shiftKey: true, key: 'F', code: 'KeyF' }), false);
}));

test('code is consulted only when the platform reports no usable key', withScript(({ api }) => {
  for (const key of ['', 'Unidentified', 'Dead', undefined]) {
    assert.equal(api.isToggleChord({ ...mods, key, code: 'KeyF' }), true, String(key));
    assert.equal(api.isToggleChord({ ...mods, key, code: 'KeyY' }), false, String(key));
  }
}));

test('the chord toggles the panel from the page and from inside the panel', withScript(({ api, window, document }) => {
  const press = (target, shape) => {
    const e = new window.KeyboardEvent('keydown', { ...shape, bubbles: true, composed: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  assert.equal(api.mode, 'launcher');
  assert.equal(press(document.body, DVORAK_F).defaultPrevented, true);
  assert.equal(api.mode, 'panel');
  press(api.shadow.querySelector('input[type="search"]'), DVORAK_F_CTRL);
  assert.equal(api.mode, 'launcher', 'toggles once, not twice, from inside the panel');
  press(document.body, { ...mods, key: 'U', code: 'KeyF' });
  assert.equal(api.mode, 'launcher');
}));

// F6: key events from the shadow root are retargeted to the host, so page
// hotkeys (Substack binds "/") would fire while typing in the search field.
test('F6: keys typed in the panel do not reach page-level listeners', withScript(({ api, window, document }) => {
  const seen = [];
  document.addEventListener('keydown', (e) => seen.push(e.key));
  const field = api.shadow.querySelector('input[type="search"]');
  const slash = new window.KeyboardEvent('keydown', { key: '/', bubbles: true, composed: true, cancelable: true });
  field.dispatchEvent(slash);
  assert.deepEqual(seen, []);
  assert.equal(slash.defaultPrevented, false, 'the character must still type');
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: '/', bubbles: true }));
  assert.deepEqual(seen, ['/'], 'keys outside the panel are left alone');
}));
