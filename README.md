# Brace

A small, dependency-free browser extension for **Brave** (and any Chromium browser) that turns raw JSON into a
readable, collapsible tree, plus a paste-and-format page one click away.

- **Automatic.** Open any JSON URL or `.json` file and it becomes a tree: colored by type, collapsible, with
  item counts and clickable links. The original text is one click away under **Raw**.
- **Lossless.** A hand-written parser keeps numbers exactly as written, so `12345678901234567890` stays that
  instead of being rounded, `9.90` keeps its trailing zero, and duplicate keys aren't silently dropped.
- **Find things fast.** Click a key to copy its path (`projects[3].tags`), click a value to copy the value. Search
  highlights matches in keys and values and expands the tree to each one (`/` to search, Enter for the next match).
- **Big files.** Children render only when expanded and long lists render 250 at a time, so multi-megabyte
  responses stay smooth.
- **Clear errors.** Invalid JSON keeps its text with the problem marked: "Line 3, column 21: Trailing comma is not
  allowed in JSON".
- **Paste page.** Click the toolbar button to paste, open or drop a file; it validates as you type, shows a tree or
  text with 2, 4, tab or minified indentation, and copies or downloads the result. ⌘/Ctrl + Enter formats the input
  in place.
- **Private.** Nothing leaves the browser. No accounts, servers or analytics.

## Build

You need [Node.js](https://nodejs.org) 18 or newer. TypeScript and the Chrome API type definitions are the only
packages, used at build time; the extension itself is plain JavaScript with no runtime dependencies.

```bash
npm install
```

```bash
npm run build
```

The ready-to-load extension is written to `dist/`.

## Install in Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the **`dist`** folder (not the project folder).
4. Pin Brace: click the puzzle-piece icon in the toolbar, then the pin next to Brace.

To format local `.json` files opened from disk, click **Details** on Brace's card and turn on **Allow access to file
URLs**. The same steps work in Chrome (`chrome://extensions`), Edge and other Chromium browsers. After rebuilding,
click the reload arrow on Brace's card.

## How it works

| File | Role |
|---|---|
| `src/detect.ts` | Runs on every page and only checks whether it's raw JSON (a JSON content type, or plain text starting with `{` or `[`). |
| `src/background.ts` | Injects the viewer into pages the detector reports, and opens the paste page from the toolbar button. |
| `src/parse.ts` | The lossless parser and formatter, with line and column error positions. |
| `src/viewer.ts` | The collapsible tree, path copying and search, shared by JSON pages and the paste page. |
| `src/page.ts` | The JSON page layout: toolbar, tree or raw text, status bar. |
| `src/tool.ts` | The paste-and-format page. |
| `scripts/make-icons.mjs` | Regenerates the toolbar icons (`node scripts/make-icons.mjs`). |

Anti-hijacking prefixes such as `)]}'` (used by some Google APIs) are stripped before parsing.

## Author

Made by [@natgurlain](https://x.com/natgurlain). MIT licensed.
