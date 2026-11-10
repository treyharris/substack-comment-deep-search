# Substack Comment Deep Search

A userscript that searches a Substack comment thread all the way down. Substack shows comments a page at a time behind a "Load More" button, so the browser's Find only sees what's loaded. This script clicks Load More for you until your term turns up or the thread runs out, then highlights the matches and lets you step between them.

Developed and tested on [The Bulwark](https://www.thebulwark.com) in Safari on iPad and macOS. It also runs on `*.substack.com`, where it is less tested ([#6](../../issues/6)).

## Install

You need a userscript manager:

- **Safari (macOS, iPadOS, iOS):** [Userscripts](https://github.com/quoid/userscripts). This is the tested setup.
- **Other browsers:** [Tampermonkey](https://www.tampermonkey.net) or [Violentmonkey](https://violentmonkey.github.io). Expected to work; not yet verified.

Then open the script's raw URL and accept the manager's install prompt (in Userscripts, open the extension's popup on that page):

<https://raw.githubusercontent.com/treyharris/substack-comment-deep-search/main/substack-comment-deep-search.user.js>

The version you're running is shown in the panel's status line before your first search.

## Usage

The script appears only on comment pages (`/p/<slug>/comments` or `/p/<slug>/comment/<id>`), as a red **s//** button at bottom right.

1. Tap **s//** to open the panel.
2. Type a term and press **Search** or Enter. Plain searches are case-insensitive.
3. The script checks the loaded comments, and if the term isn't there, loads more and checks again. It stops at the first load that contains a match, or at the end of the thread. **Stop** interrupts it.
4. Step through matches with **Prev** / **Next**. With the panel collapsed, **↑** / **↓** buttons beside the launcher do the same, and a badge shows your position (`3/7`).

Comment text and author names are searched; buttons and timestamps are not.

**Load whole thread before matching** loads everything first, then highlights every match in the thread. Without it, the matches are those loaded so far, and Next wraps around at the last one.

**Clear** removes the highlights. Loaded comments stay loaded.

### Regex mode

A leading `/` switches to a JavaScript regular expression: `/pattern/flags`. The closing slash and flags are optional.

- Case-sensitive by default; add `i` to ignore case.
- Flags: `i`, `m`, `s`, `u`, `v`.
- A slash inside the pattern is fine as `[/]`. The last `/` ends the pattern only if nothing but flag letters follows it.
- A pattern can't match across a paragraph break ([#1](../../issues/1)).

Examples: `/Trump|Miller`, `/\bfolks\b/i`, `/[$]\d+`.

## Keyboard

| Input | Effect |
|---|---|
| Enter (in the search field) | Search |
| Escape | Stop a running search; otherwise collapse the panel |
| Option+Shift+F, with or without Control | Open or collapse the panel |
| Tap or click outside the panel | Collapse it |
| Long-press or right-click the **⌄** chevron | Offer "Hide until reload" |

"Hide until reload" removes the widget until you reload or navigate to another page. If Option+Shift+F doesn't work on your keyboard layout, add Control, and see [#5](../../issues/5).

## If the button turns yellow

Substack's page markup has changed and no longer matches what the script expects. Open the panel to see which part broke. **Search anyway** lets you carry on, but results may be incomplete or include page furniture.

Please [open an issue](../../issues) and include:

- the list shown in the panel, or the `[comment search] selector drift` line from the browser console;
- the publication and page you were on;
- the script version from the status line.

## Known limits

- Patterns can't span paragraphs ([#1](../../issues/1)).
- A pathological regex can freeze the tab on one long paragraph ([#2](../../issues/2)).
- Very long threads stop after 400 loads.

## License

[MIT](LICENSE)
