// ==UserScript==
// @name         Substack Comment Deep Search
// @namespace    https://github.com/treyharris
// @version      1.7.5
// @description  Search a Substack comment thread, auto-clicking "Load More" until the term is found or the thread is exhausted.
// @author       Trey Harris
// @license      MIT
// @match        https://www.thebulwark.com/*
// @match        https://thebulwark.com/*
// @match        https://*.substack.com/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://gist.github.com/treyharris/f1c5a319d58d40bcd870f6849b56c84a
// @supportURL   https://gist.github.com/treyharris/f1c5a319d58d40bcd870f6849b56c84a
// @downloadURL  https://gist.githubusercontent.com/treyharris/f1c5a319d58d40bcd870f6849b56c84a/raw/substack-comment-deep-search.user.js
// @updateURL    https://gist.githubusercontent.com/treyharris/f1c5a319d58d40bcd870f6849b56c84a/raw/substack-comment-deep-search.user.js
// ==/UserScript==

// Copyright (c) 2026 Trey Harris
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Usage notes:
//   • Appears only on Substack comment pages (/p/<slug>/comments or
//     /p/<slug>/comment/<id>), as a red "s//" button at bottom right.
//   • A leading "/" switches the search box to regex mode: /pattern/[imsuv]*
//     Case-sensitive by default; add i for insensitive.
//   • Ctrl-Option-Shift-F toggles the panel. Escape collapses it, or stops a
//     running search.
//   • Long-press or right-click the chevron to hide the widget until reload.
//   • If the button turns yellow, Substack's markup has changed and the
//     script needs updating — open it to see which selector broke.

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Configuration — the two things most likely to need tweaking are
  // LOAD_MORE_TEXT and CONTAINER_SELECTORS.
  // ---------------------------------------------------------------------
  const LOAD_MORE_TEXT = /^(load more|show more|more comments|\d+ more)/i;
  const CONTAINER_SELECTORS = ['.comments-page', '.dt-comments', '#comments'];
  const COMMENT_SELECTOR = '.comment';
  // Only these are searched and highlighted, which keeps LIKE / REPLY /
  // SHARE / Load More and the timestamps out of the results.
  const BODY_SELECTOR = '.comment-body';
  const NAME_SELECTOR = '.comment-author-name';
  const SCOPE_SELECTOR = `${BODY_SELECTOR}, ${NAME_SELECTOR}`;
  // Independent naming conventions for the same thing. We never rely on these
  // to find comments — they exist purely to corroborate COMMENT_SELECTOR.
  const CORROBORATORS = ['[id^="comment-"]', '[data-comment-id]'];
  const HEALTH_WAIT_MS = 8000;       // give the thread time to hydrate before judging
  const HEALTH_POLL_MS = 500;
  // Regex mode: a leading "/" switches it on, an optional trailing "/flags"
  // closes it. Case-sensitive by default — add i to opt out.
  const ALLOWED_FLAGS = 'imsuv';
  // A regex cannot be interrupted once running, but we match one text node at
  // a time, so a deadline checked between nodes bounds the damage to a single
  // node's worth of backtracking.
  const MATCH_BUDGET_MS = 4000;

  // DEFERRED: a "Continue (8s)" / "Continue (16s)" button for when the budget
  // above is hit. Not built, because across threads up to ~830 comments it has
  // never tripped: the slow part is network round-trips for Load More, not
  // matching. Revisit only if a real search starts hitting it.
  //
  // If it is built, two things matter. It should resume rather than restart,
  // keeping the scanner closure and load count alive, or each press redoes all
  // prior work. And it should name the cause first, because only one of the
  // two is worth more time:
  //   volume       - many nodes, each cheap. More time genuinely helps.
  //   backtracking - one node consuming the whole budget. Cost is exponential
  //                  in input length, so doubling the budget buys roughly one
  //                  more character. Suggest a narrower pattern instead.
  // Telling them apart needs two numbers the matcher does not currently keep:
  // nodes processed, and the duration of the slowest single node.

  const HINT = 'v1.7.5 — type a term, or /regex/[imsuv]* for pattern mode.';
  const HOLD_MS = 550;               // long-press threshold for the kill popup
  const YIELD_EVERY = 150;           // nodes highlighted between event-loop yields
  // waitForGrowth resolves the moment a comment appears, which can be mid-
  // render. Highlighting then races Substack's renderer, which rewrites those
  // subtrees and discards our <mark> elements — leaving a correct count of
  // detached nodes that neither show nor scroll. So wait for quiet first.
  const DOM_SETTLE_MS = 350;         // no mutations for this long = settled
  const SETTLE_CAP_MS = 3000;        // but never wait longer than this
  const GROWTH_TIMEOUT_MS = 25000;   // how long to wait for new comments after a click
  const CLICK_RETRIES = 2;           // extra attempts before declaring the thread stalled
  const POLL_MS = 250;
  const MAX_LOADS = 400;             // hard stop, in case a thread never ends

  const HOST_ID = 'scds-host';
  if (document.getElementById(HOST_ID)) return;

  let aborted = false;
  let running = false;
  let hits = [];
  let hitIndex = 0;
  let onHitsDropped = null;   // set by the UI so the badge can resync

  // ---------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------
  function getContainer() {
    for (const sel of CONTAINER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findLoadMore(container) {
    const candidates = container.querySelectorAll('button, [role="button"]');
    for (const el of candidates) {
      if (el.closest(`#${HOST_ID}`)) continue;
      const text = (el.textContent || '').trim();
      if (text.length > 40) continue;
      if (LOAD_MORE_TEXT.test(text) && isVisible(el)) return el;
    }
    return null;
  }

  // The elements we actually search: comment bodies and author names.
  function scopes(container) {
    const els = container.querySelectorAll(SCOPE_SELECTOR);
    return els.length ? Array.from(els) : [container];
  }

  const TEXT_FILTER = {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (/^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  };

  function textNodesIn(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, TEXT_FILTER);
    const out = [];
    let node;
    while ((node = walker.nextNode())) out.push(node);
    return out;
  }

  // True if rx matches something non-empty in this node's text. Zero-length
  // matches are stepped over rather than accepted — /\b/ and /x*/ match empty
  // at many positions, and no analysis of the pattern can rule that out in
  // advance, so it has to be handled per match.
  function matchesNode(rx, value) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(value)) !== null) {
      if (m[0].length) return true;
      rx.lastIndex++;
      if (rx.lastIndex > value.length) break;
    }
    return false;
  }

  // Only newly-loaded comments can contain a match we haven't already ruled
  // out, so each pass resumes where the last one stopped instead of
  // re-reading the whole thread (which gets quadratic on long threads).
  //
  // Critically, this walks text nodes exactly as highlight() does. Testing
  // element.textContent instead would join adjacent <p> paragraphs with no
  // separator, so "…trivia." + "I don't…" reads as "…trivia.I don't…" and a
  // pattern could match across a join the highlighter can never reproduce —
  // stopping the load early and then reporting no matches at all.
  function makeScanner(container, rx) {
    let scanned = 0;
    return function scanNew() {
      const els = container.querySelectorAll(SCOPE_SELECTOR);
      const roots = els.length ? els : [container];
      // If the list shrank or re-sorted, our index is meaningless — start over.
      if (roots.length < scanned) scanned = 0;
      const deadline = Date.now() + MATCH_BUDGET_MS;
      for (let i = scanned; i < roots.length; i++) {
        for (const node of textNodesIn(roots[i])) {
          if (Date.now() > deadline) {
            scanned = i;
            return { found: false, timedOut: true };
          }
          if (matchesNode(rx, node.nodeValue)) {
            scanned = i;
            return { found: true };
          }
        }
      }
      scanned = roots.length;
      return { found: false };
    };
  }

  function countComments(container) {
    return container.querySelectorAll(COMMENT_SELECTOR).length;
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Resolves as soon as a new comment node appears, rather than waiting out
  // a fixed poll interval. Falls back to polling in case mutations are missed.
  function waitForGrowth(container, beforeCount) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearInterval(poller);
        clearTimeout(timer);
        resolve(value);
      };
      const check = () => {
        if (aborted) return finish(false);
        if (countComments(container) > beforeCount) return finish(true);
      };
      const observer = new MutationObserver(check);
      observer.observe(container, { childList: true, subtree: true });
      const poller = setInterval(check, POLL_MS);
      const timer = setTimeout(() => finish(false), GROWTH_TIMEOUT_MS);
      check();
    });
  }

  // Resolves once the container has gone DOM_SETTLE_MS without a mutation,
  // or SETTLE_CAP_MS total — whichever comes first.
  function waitForQuiet(container) {
    return new Promise((resolve) => {
      let quiet;
      let abortPoll;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(quiet);
        clearTimeout(cap);
        clearInterval(abortPoll);
        resolve();
      };
      const bump = () => {
        clearTimeout(quiet);
        quiet = setTimeout(finish, DOM_SETTLE_MS);
      };
      const observer = new MutationObserver(bump);
      observer.observe(container, { childList: true, subtree: true, characterData: true });
      const cap = setTimeout(finish, SETTLE_CAP_MS);
      // Without this, Stop could sit for the full cap waiting for a settle
      // that no longer matters.
      abortPoll = setInterval(() => { if (aborted) finish(); }, 100);
      bump();
    });
  }

  // Scrolling on every iteration keeps the page in near-constant motion, and
  // on iOS a tap during momentum scrolling is swallowed as a scroll-stopping
  // gesture rather than dispatched as a click — which makes Stop feel dead.
  // Only scroll when the button is actually out of view.
  function ensureVisible(el) {
    const r = el.getBoundingClientRect();
    const h = window.innerHeight || document.documentElement.clientHeight;
    if (r.top >= 0 && r.bottom <= h) return false;
    el.scrollIntoView({ block: 'center' });
    return true;
  }

  // A plain .click() is enough for most React buttons. If one doesn't take,
  // this synthesizes the full pointer sequence before clicking.
  function clickHard(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
    } catch (e) {
      /* PointerEvent unavailable — the plain click below still runs */
    }
    el.click();
  }

  // ---------------------------------------------------------------------
  // Health check
  //
  // Substack will eventually rename these classes, and every failure mode is
  // silent: a dead COMMENT_SELECTOR reads as "no new comments arrived", a dead
  // BODY_SELECTOR makes scopes() fall back to the whole container and start
  // highlighting REPLY / SHARE labels. So we compare our selectors against
  // independently-named equivalents and against each other.
  //
  // The asymmetry matters: a dead corroborator on its own means nothing (it
  // may never have existed on this page), but a dead COMMENT_SELECTOR while a
  // corroborator is alive is unambiguous. A redesign that renames everything
  // at once would still slip through — that gap is accepted.
  // ---------------------------------------------------------------------
  function diagnose() {
    const container = getContainer();
    const comments = container.querySelectorAll(COMMENT_SELECTOR);
    const corroborated = CORROBORATORS.reduce(
      (n, sel) => n + container.querySelectorAll(sel).length,
      0
    );
    const bodies = container.querySelectorAll(BODY_SELECTOR).length;
    const names = container.querySelectorAll(NAME_SELECTOR).length;
    const withBody = Array.from(comments).filter((c) => c.querySelector(BODY_SELECTOR)).length;

    const problems = [];

    if (container === document.body && (comments.length || corroborated)) {
      problems.push(`No comments container matched (${CONTAINER_SELECTORS.join(', ')}). Falling back to the whole page, so results may include page furniture.`);
    }
    if (!comments.length && corroborated) {
      problems.push(`${COMMENT_SELECTOR} matched nothing, but ${corroborated} comment markers are present. Loading more comments will not work.`);
    }
    if (comments.length && !bodies) {
      problems.push(`${BODY_SELECTOR} matched nothing across ${comments.length} comments. Comment text cannot be searched.`);
    } else if (comments.length && !withBody) {
      problems.push(`${BODY_SELECTOR} exists but no ${COMMENT_SELECTOR} contains one — the nesting has changed.`);
    }
    if (comments.length && !names) {
      problems.push(`${NAME_SELECTOR} matched nothing. Author names cannot be searched.`);
    }

    return {
      problems,
      hydrated: comments.length > 0 || corroborated > 0,
      counts: { comments: comments.length, corroborated, bodies, names, withBody },
    };
  }
  // ---------------------------------------------------------------------
  // Highlighting
  // ---------------------------------------------------------------------
  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // "foo"        → literal, case-insensitive
  // "/foo"       → regex, case-sensitive, no terminator needed
  // "/foo/i"     → regex with flags
  // "/A[/]B"     → the last slash is only a terminator when what follows it is
  //                entirely flag letters, so bracket-escaped slashes survive
  function parseQuery(raw) {
    const text = raw.trim();
    if (!text) return { error: 'Enter a search term.' };
    if (text[0] !== '/') {
      return { rx: new RegExp(escapeRe(text), 'gi'), regex: false };
    }

    let source = text.slice(1);
    let flags = '';
    const close = source.lastIndexOf('/');
    if (close > -1) {
      const tail = source.slice(close + 1).trim();
      if (tail === '' || /^[A-Za-z]+$/.test(tail)) {
        const bad = tail.split('').filter((f) => !ALLOWED_FLAGS.includes(f) && f !== 'g');
        if (bad.length) {
          return { error: `Unknown flag${bad.length > 1 ? 's' : ''} "${bad.join('')}". Allowed: ${ALLOWED_FLAGS.split('').join(' ')}.` };
        }
        flags = tail.replace(/g/g, '');
        source = source.slice(0, close);
      }
    }

    if (!source) return { error: 'Empty pattern.' };
    try {
      return { rx: new RegExp(source, flags + 'g'), regex: true };
    } catch (e) {
      return { error: `Invalid pattern — ${e.message}` };
    }
  }

  function clearHighlights() {
    const parents = new Set();
    document.querySelectorAll('mark.scds-hit').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parents.add(parent);
    });
    parents.forEach((p) => p.normalize());
    hits = [];
    hitIndex = 0;
  }

  // Async because a thread with thousands of matches would otherwise do every
  // DOM replacement in one synchronous burst, freezing the tab for seconds.
  async function highlight(container, rx) {
    clearHighlights();
    // Collect first: replacing nodes while a TreeWalker is mid-walk is unsafe.
    const nodes = [];
    scopes(container).forEach((scope) => {
      textNodesIn(scope).forEach((n) => nodes.push(n));
    });

    const deadline = Date.now() + MATCH_BUDGET_MS;
    let timedOut = false;

    let since = 0;
    for (const node of nodes) {
      if (Date.now() > deadline) {
        timedOut = true;
        break;
      }
      if (++since >= YIELD_EVERY) {
        since = 0;
        await wait(0);
      }
      const value = node.nodeValue;
      let frag = null;
      let last = 0;
      let m;
      rx.lastIndex = 0;
      while ((m = rx.exec(value)) !== null) {
        if (!m[0].length) {
          rx.lastIndex++;
          if (rx.lastIndex > value.length) break;
          continue;
        }
        if (!frag) frag = document.createDocumentFragment();
        if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)));
        const mark = document.createElement('mark');
        mark.className = 'scds-hit';
        mark.textContent = m[0];
        frag.appendChild(mark);
        last = m.index + m[0].length;
      }
      if (frag) {
        if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    }

    hits = Array.from(document.querySelectorAll('mark.scds-hit'));
    return { count: hits.length, timedOut };
  }

  function focusHit(i) {
    // A mark can be orphaned by a re-render after we collected it; scrolling
    // to one does nothing and looks like a dead button.
    if (hits.some((h) => !h.isConnected)) {
      hits = hits.filter((h) => h.isConnected);
      if (onHitsDropped) onHitsDropped();
    }
    if (!hits.length) return;
    hitIndex = (i + hits.length) % hits.length;
    hits.forEach((h) => h.classList.remove('scds-current'));
    const target = hits[hitIndex];
    target.classList.add('scds-current');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setCount(`${hitIndex + 1} of ${hits.length}`);
  }

  // ---------------------------------------------------------------------
  // The search loop
  // ---------------------------------------------------------------------
  async function run(query, loadAll) {
    if (running) return;
    running = true;
    aborted = false;
    clearHighlights();
    const container = getContainer();
    const rx = query.rx;
    const scanNew = makeScanner(container, rx);
    const scrollY = window.scrollY;
    let loads = 0;
    let stalls = 0;
    let reason = '';

    setBusy(true);
    refreshHealth(false);

    while (!aborted) {
      if (!loadAll) {
        const scan = scanNew();
        if (scan.timedOut) {
          reason = 'slow';
          break;
        }
        if (scan.found) {
          reason = 'found';
          break;
        }
      }

      const btn = findLoadMore(container);
      if (!btn) {
        reason = 'exhausted';
        break;
      }
      if (loads >= MAX_LOADS) {
        reason = 'limit';
        break;
      }

      const count = countComments(container);
      setStatus(
        stalls
          ? `Retrying (attempt ${stalls + 1}, ${count} comments loaded)…`
          : `Loading more… (${loads + 1}, ${count} comments so far)`
      );
      if (ensureVisible(btn)) await wait(150);
      if (stalls === 0) btn.click(); else clickHard(btn);

      if (await waitForGrowth(container, count)) {
        await waitForQuiet(container);
        loads++;
        stalls = 0;
      } else if (aborted) {
        // Stop landed mid-load. The page may have grown anyway, so don't
        // under-report what was actually fetched.
        if (countComments(container) > count) loads++;
        break;
      } else {
        stalls++;
        console.log('[comment search] no growth after click', {
          attempt: stalls,
          commentsBefore: count,
          commentsAfter: countComments(container),
          buttonStillPresent: !!findLoadMore(container),
        });
        if (stalls > CLICK_RETRIES) {
          reason = 'stalled';
          break;
        }
        await wait(500);
      }
    }

    let found = await highlight(container, rx);
    // Belt and braces: if a late render tore our marks out anyway, wait for
    // quiet and redo them once.
    if (found.count && loads) {
      await wait(250);
      if (hits.some((h) => !h.isConnected)) {
        await waitForQuiet(container);
        found = await highlight(container, rx);
      }
    }
    const total = countComments(container);
    const loadNote = `${loads} load${loads === 1 ? '' : 's'}, ${total} comments`;

    if (found.count) {
      const plural = found.count === 1 ? '' : 'es';
      let scope = '';
      if (aborted) scope = ' so far — stopped before the end';
      else if (reason === 'exhausted' || loadAll) scope = ' in the whole thread';
      setStatus(`${found.count} match${plural}${scope} (${loadNote}).`);
      focusHit(0);
    } else if (reason === 'slow' || found.timedOut) {
      setStatus(`Pattern too slow — stopped after ${loadNote}. Try a more specific pattern.`);
    } else if (aborted) {
      setStatus(`Stopped by you — no match yet (${loadNote}).`);
    } else if (reason === 'stalled') {
      setStatus(`No new comments arrived after the last click (${loadNote}). Scroll down and try again.`);
    } else if (reason === 'limit') {
      setStatus(`Hit the ${MAX_LOADS}-load limit with no match (${loadNote}).`);
    } else {
      setStatus(`No match anywhere in the thread (${loadNote}).`);
      window.scrollTo({ top: scrollY });
    }

    setBusy(false);
    updateLauncher();
    refreshHealth(false);
    running = false;
  }

  // ---------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------
  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel, .launcher {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
      }
      .panel {
        width: 280px;
        max-width: calc(100vw - 32px);
        background: #16181d;
        color: #f2f2f2;
        border: 1px solid #3a3f4a;
        border-radius: 12px;
        padding: 10px;
        box-shadow: 0 6px 24px rgba(0,0,0,.35);
      }
      .panel[hidden], .launcher[hidden] { display: none; }
      .row { display: flex; gap: 6px; align-items: center; }
      .row + .row { margin-top: 8px; }
      input[type="search"] {
        flex: 1; min-width: 0;
        padding: 7px 8px;
        border: 1px solid #4a505c;
        border-radius: 5px;
        background: #0f1114;
        color: #f2f2f2;
        font: inherit;
      }
      input:focus-visible { outline: 2px solid #c8102e; outline-offset: 1px; }
      button {
        padding: 7px 10px;
        border: 1px solid #4a505c;
        border-radius: 5px;
        background: #262a32;
        color: #f2f2f2;
        font: inherit;
        cursor: pointer;
      }
      button:hover { background: #323844; }
      button.primary { background: #c8102e; border-color: #c8102e; }
      button:disabled { opacity: .5; cursor: default; }
      .nav button { padding: 5px 9px; }
      .head { margin-bottom: 2px; }
      .head .brand {
        font: 600 14px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #b6bcc7;
        letter-spacing: .5px;
      }
      .head button {
        padding: 2px 7px;
        border: 0;
        background: none;
        color: #b6bcc7;
        font-size: 15px;
        line-height: 1;
      }
      .head button:hover { background: #262a32; color: #f2f2f2; }
      .head .min {
        margin-left: auto;
        font-size: 17px;
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        user-select: none;
      }
      .killpop {
        position: absolute;
        top: 32px;
        right: 8px;
        z-index: 1;
        background: #22262e;
        border: 1px solid #4a505c;
        border-radius: 8px;
        padding: 6px;
        box-shadow: 0 6px 18px rgba(0,0,0,.45);
      }
      .killpop[hidden] { display: none; }
      .killpop button { white-space: nowrap; }
      .opt { font-size: 12px; color: #b6bcc7; cursor: pointer; }
      .opt input { flex: 0 0 auto; width: auto; }
      .status { margin-top: 8px; font-size: 12px; color: #b6bcc7; }

      .status .nomatch { color: #ff6b6b; font-weight: 700; }
      .count { font-size: 12px; color: #b6bcc7; margin-left: auto; }

      .launcher { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
      .sq {
        position: relative;
        width: 46px;
        height: 46px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 15px;
        border: 1px solid #3a3f4a;
        background: #16181d;
        color: #f2f2f2;
        box-shadow: 0 4px 16px rgba(0,0,0,.35);
      }
      .sq.mark {
        font: 600 17px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        background: #c8102e;
        border-color: #c8102e;
        color: #fff;
      }
      .sq.mark:hover { background: #d8203e; }
      .sq.mark.warn { background: #f5c518; border-color: #f5c518; color: #111; }
      .sq.mark.warn:hover { background: #ffd633; }
      .alert-title { color: #f5c518; font-weight: 600; margin-bottom: 6px; }
      .alert-list { margin: 0 0 8px; padding-left: 18px; font-size: 12px; color: #e4e7ec; }
      .alert-list li + li { margin-top: 5px; }
      .alert-foot { margin: 0 0 10px; font-size: 12px; color: #b6bcc7; }
      .sq.arrow { font-size: 20px; }
      /* Class selectors outrank the UA [hidden] rule, so restate it. */
      .sq[hidden], .launcher [hidden] { display: none; }
      .badge {
        position: absolute;
        top: -7px;
        right: -7px;
        background: #16181d;
        color: #fff;
        border: 1px solid rgba(255,255,255,.4);
        border-radius: 999px;
        padding: 2px 6px;
        font: 500 11px/1.2 -apple-system, BlinkMacSystemFont, sans-serif;
        white-space: nowrap;
      }
      .badge[hidden] { display: none; }
    </style>
    <div class="launcher">
      <button class="open sq mark" title="Search comments">s//<span class="badge" hidden></span></button>
      <button class="lnext sq arrow" title="Next match" hidden>↓</button>
      <button class="lprev sq arrow" title="Previous match" hidden>↑</button>
    </div>
    <div class="panel" part="panel" hidden>
      <div class="row head">
        <span class="brand">s//</span>
        <button class="min" title="Collapse (hold for more)">⌄</button>
      </div>
      <div class="killpop" hidden>
        <button class="killbtn">Hide until reload</button>
      </div>
      <div class="alert" hidden>
        <div class="alert-title">Page markup has changed</div>
        <ul class="alert-list"></ul>
        <p class="alert-foot">The script needs updating. Searching may still work in part.</p>
        <button class="anyway">Search anyway</button>
      </div>
      <div class="controls">
        <div class="row">
          <input type="search" placeholder="Search comments, or /regex/[flags]" autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="row">
          <button class="primary go">Search</button>
          <button class="stop" disabled>Stop</button>
          <span class="count"></span>
        </div>
        <div class="row nav">
          <button class="prev">← Prev</button>
          <button class="next">Next →</button>
          <button class="clear">Clear</button>
        </div>
        <label class="row opt">
          <input type="checkbox" class="loadall">
          <span>Load whole thread before matching</span>
        </label>
        <div class="status"></div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(host);

  const panel = shadow.querySelector('.panel');
  const launcher = shadow.querySelector('.launcher');
  const input = shadow.querySelector('input[type="search"]');
  const goBtn = shadow.querySelector('.go');
  const stopBtn = shadow.querySelector('.stop');
  const statusEl = shadow.querySelector('.status');
  const countEl = shadow.querySelector('.count');
  const badge = shadow.querySelector('.badge');
  const lNext = shadow.querySelector('.lnext');
  const lPrev = shadow.querySelector('.lprev');
  const openBtn = shadow.querySelector('.open');
  const alertEl = shadow.querySelector('.alert');
  const alertList = shadow.querySelector('.alert-list');
  const controlsEl = shadow.querySelector('.controls');

  onHitsDropped = () => {
    setCount(hits.length ? `${hits.length} left` : '');
    updateLauncher();
  };

  let health = { problems: [] };
  let alertDismissed = false;   // reset on every navigation, not persisted

  function applyHealth(updateView = true) {
    const broken = health.problems.length > 0;
    openBtn.classList.toggle('warn', broken);
    if (updateView) {
      const showAlert = broken && !alertDismissed;
      alertEl.hidden = !showAlert;
      controlsEl.hidden = showAlert;
    }
    if (broken) {
      alertList.textContent = '';
      health.problems.forEach((p) => {
        const li = document.createElement('li');
        li.textContent = p;
        alertList.appendChild(li);
      });
      console.warn('[comment search] selector drift', health.problems, health.counts);
    }
  }

  function refreshHealth(updateView = true) {
    health = diagnose();
    applyHealth(updateView);
  }

  // The list hydrates after document-idle, so an immediate check would see an
  // empty page and cry wolf. Wait for signs of life, then judge. If nothing
  // ever shows up, stay quiet — that's a thread with no comments.
  async function watchHealth() {
    const deadline = Date.now() + HEALTH_WAIT_MS;
    while (Date.now() < deadline) {
      const result = diagnose();
      if (result.hydrated) {
        health = result;
        applyHealth();
        return;
      }
      await wait(HEALTH_POLL_MS);
    }
  }

  // 'launcher' = collapsed squircle, 'panel' = open, 'hidden' = out of the way
  let mode = 'launcher';

  function updateLauncher() {
    const hasHits = hits.length > 0;
    lNext.hidden = !hasHits;
    lPrev.hidden = !hasHits;
    badge.hidden = !hasHits;
    if (hasHits) badge.textContent = `${hitIndex + 1}/${hits.length}`;
  }

  function setMode(next) {
    mode = next;
    panel.hidden = next !== 'panel';
    launcher.hidden = next !== 'launcher';
    updateLauncher();
    if (next === 'panel') {
      // Drift found mid-search only recolors the button, so results aren't
      // replaced under you. Opening the panel is the moment to actually show
      // what went wrong — otherwise the yellow has no explanation attached.
      applyHealth(true);
      setTimeout(() => input.focus(), 0);
    }
  }

  // "No match" is the one result worth not skimming past, so it gets weight
  // and color. Built from text nodes rather than innerHTML — some of what
  // lands here is a regex engine's error text.
  function setStatus(t) {
    const marker = 'No match';
    const at = t.indexOf(marker);
    statusEl.textContent = '';
    if (at === -1) {
      statusEl.textContent = t;
      return;
    }
    statusEl.appendChild(document.createTextNode(t.slice(0, at)));
    const strong = document.createElement('strong');
    strong.className = 'nomatch';
    strong.textContent = marker;
    statusEl.appendChild(strong);
    statusEl.appendChild(document.createTextNode(t.slice(at + marker.length)));
  }
  function setCount(t) { countEl.textContent = t; updateLauncher(); }
  function setBusy(b) {
    goBtn.disabled = b;
    stopBtn.disabled = !b;
    goBtn.textContent = b ? 'Searching…' : 'Search';
  }

  const loadAllBox = shadow.querySelector('.loadall');

  goBtn.addEventListener('click', () => {
    const query = parseQuery(input.value);
    if (query.error) {
      setStatus(query.error);
      return;
    }
    setCount('');
    setStatus(query.regex ? 'Regex mode (case-sensitive unless /i).' : 'Searching…');
    run(query, loadAllBox.checked);
  });
  // Enter is handled by the window-capture listener below, which has to run
  // before Substack's document hotkeys — a listener here would never see it.

  // Emptying the field — by backspace or the native clear button — brings the
  // flag letters back, since the status line is where they live.
  input.addEventListener('input', () => {
    if (!input.value) setStatus(HINT);
  });
  // pointerdown fires even when a following click would be swallowed by
  // momentum scrolling; click stays for keyboard activation. Setting the flag
  // twice is harmless.
  const abort = () => { aborted = true; setStatus('Stopping…'); };
  stopBtn.addEventListener('pointerdown', abort);
  stopBtn.addEventListener('click', abort);
  shadow.querySelector('.next').addEventListener('click', () => focusHit(hitIndex + 1));
  shadow.querySelector('.prev').addEventListener('click', () => focusHit(hitIndex - 1));
  lNext.addEventListener('click', () => focusHit(hitIndex + 1));
  lPrev.addEventListener('click', () => focusHit(hitIndex - 1));
  shadow.querySelector('.anyway').addEventListener('click', () => {
    alertDismissed = true;
    applyHealth();
    input.focus();
  });
  openBtn.addEventListener('click', () => setMode('panel'));
  const minBtn = shadow.querySelector('.min');
  const killPop = shadow.querySelector('.killpop');
  const killBtn = shadow.querySelector('.killbtn');
  let holdTimer = null;
  let holdFired = false;

  function openKill() {
    if (!killPop.hidden) return;   // idempotent: both input paths may fire
    killPop.hidden = false;
    killBtn.focus();
  }
  function closeKill() { killPop.hidden = true; }

  minBtn.addEventListener('pointerdown', (e) => {
    holdFired = false;
    if (e.pointerType === 'mouse' && e.button !== 0) return;  // contextmenu handles it
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { holdFired = true; openKill(); }, HOLD_MS);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) =>
    minBtn.addEventListener(t, () => clearTimeout(holdTimer))
  );
  // A finger that slides is scrolling, not holding.
  minBtn.addEventListener('pointermove', (e) => {
    if (Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) > 8) clearTimeout(holdTimer);
  });
  // iOS raises its own callout on long press; suppress it. This also catches
  // secondary click, Ctrl-click, the context-menu key and Shift+F10.
  minBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openKill();
  });
  minBtn.addEventListener('click', (e) => {
    if (holdFired) {   // swallow the click that follows a completed hold
      e.preventDefault();
      e.stopPropagation();
      holdFired = false;
      return;
    }
    setMode('launcher');
  });

  killBtn.addEventListener('click', () => {
    closeKill();
    // Hidden until reload or navigation: syncVisibility restores display on
    // the next path change, so no separate flag is needed to track this.
    host.style.display = 'none';
  });

  // Light dismiss: a tap anywhere outside collapses rather than closes, so the
  // reflexive gesture lands on the safe action.
  document.addEventListener('pointerdown', (e) => {
    if (typeof e.composedPath === 'function' && e.composedPath().includes(host)) return;
    if (!killPop.hidden) closeKill();
    if (mode === 'panel') setMode('launcher');
  }, true);
  shadow.querySelector('.clear').addEventListener('click', () => {
    clearHighlights();
    setCount('');
    setStatus('Highlights cleared. Loaded comments stay loaded.');
  });

  // Substack binds single-key hotkeys on the document ("/" opens site search)
  // and decides whether to ignore them by inspecting event.target. Keyboard
  // events crossing a shadow boundary are retargeted to the host element, so
  // Substack sees our <div> rather than the <input> inside it, concludes
  // nobody is typing, and fires the hotkey mid-word. Swallowing our own key
  // events at window capture — ahead of any document-level listener — keeps
  // them inside the panel. stopPropagation does not suppress the default
  // action, so the character still types.
  function isOurs(e) {
    return typeof e.composedPath === 'function' && e.composedPath().includes(host);
  }

  ['keydown', 'keypress', 'keyup'].forEach((type) => {
    window.addEventListener(type, (e) => {
      if (!isOurs(e)) return;
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (type !== 'keydown') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!killPop.hidden) closeKill();
        else if (running) abort();
        else setMode('launcher');
      } else if (e.key === 'Enter' && e.composedPath().includes(input)) {
        e.preventDefault();
        goBtn.click();
      } else if (isToggleChord(e)) {
        e.preventDefault();
        setMode(mode === 'panel' ? 'launcher' : 'panel');
      }
    }, true);
  });

  // Option-Shift-F toggles the panel, with or without Control.
  //
  // Match e.key, not e.code. The usual advice is the reverse — e.code is
  // "layout independent" — but it reports a physical key *position*, which is
  // only equivalent to the letter on QWERTY. On Dvorak the F key reports
  // code "KeyY", so a code === 'KeyF' test both misses the real F and fires
  // on whatever sits at the QWERTY F position (U, on Dvorak).
  //
  // The remaining wrinkle is macOS Option-composition: Option-Shift-F emits
  // key "Ï" rather than "F". Holding Control suppresses that and gives "F".
  // Accept both spellings. e.code is used only as a last resort, when the
  // platform gives us no usable key at all.
  function isToggleChord(e) {
    if (!e.altKey || !e.shiftKey) return false;
    const k = (e.key || '').toLowerCase();
    if (k === 'f' || k === 'ï') return true;
    return (!k || k === 'unidentified' || k === 'dead') && e.code === 'KeyF';
  }

  // Same shortcut, for when focus is outside the panel entirely.
  document.addEventListener('keydown', (e) => {
    if (isToggleChord(e)) {
      e.preventDefault();
      setMode(mode === 'panel' ? 'launcher' : 'panel');
    }
  });

  // Only show on comment pages:
  //   /p/<slug>/comments        (thread view)
  //   /p/<slug>/comment/<id>    (single comment permalink)
  // Query strings and # anchors are ignored, since we test the path alone.
  function isCommentPage() {
    return /^\/p\/[^/]+\/comment(s|\/\d+)\/?$/.test(location.pathname);
  }

  // Substack navigates client-side, so the path can change without a reload.
  let lastPath = null;
  function syncVisibility() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    if (isCommentPage()) {
      host.style.display = '';
      clearHighlights();
      setCount('');
      setMode('launcher');
      alertDismissed = false;
      health = { problems: [] };
      applyHealth();
      watchHealth();
    } else {
      host.style.display = 'none';
      clearHighlights();
    }
  }

  setStatus(HINT);
  setInterval(syncVisibility, 700);
  window.addEventListener('popstate', syncVisibility);
  syncVisibility();

  // Highlight styles live in the page, not the shadow root.
  const pageStyle = document.createElement('style');
  pageStyle.textContent = `
    mark.scds-hit { background: #ffe27a; color: #000; padding: 0 1px; border-radius: 2px; }
    mark.scds-hit.scds-current { background: #ff8a3d; box-shadow: 0 0 0 2px rgba(255,138,61,.5); }
  `;
  document.head.appendChild(pageStyle);
})();
