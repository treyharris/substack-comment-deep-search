'use strict';
// Wraps a test body so it gets a freshly loaded script and always closes it.
const { load } = require('./load');

function withScript(options, body) {
  if (typeof options === 'function') { body = options; options = {}; }
  return async () => {
    const t = load(options);
    try {
      await body(t);
    } finally {
      t.close();
    }
  };
}

module.exports = { withScript };
