# Conversation Archive
 
A browser extension that saves your ChatGPT, Claude, or Gemini conversation
as a PDF, Markdown (`.md`), or plain text (`.txt`) file. Everything runs
locally in your browser — the extension reads the conversation already on
the page and never sends it anywhere.
 
Works in any Chromium-based browser: **Chrome, Opera GX, Edge, Brave,** etc.
 
## What's new in v2
 
The extension no longer uses a toolbar popup. Instead, `content.js` injects
a split button directly into the page itself — a "Save as PDF" button with
a gear icon next to it that opens a dropdown for Markdown/plain text. It
sits in the page's own header when it can find one, and falls back to a
floating button in the bottom-right corner when it can't. A
`MutationObserver` watches the page and re-injects the button any time the
host app's re-rendering removes it, which ChatGPT/Claude/Gemini all do
routinely since they're single-page apps.
 
## Install (unpacked / developer mode)
 
1. Unzip this folder somewhere permanent (don't delete it later — the
   browser loads the extension from this folder each time it starts).
2. Open `chrome://extensions` (Opera GX: `opera://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder.
## Use it
 
1. Open a conversation on `chatgpt.com`, `claude.ai`, or
   `gemini.google.com`.
2. A **Save as PDF** button appears in the page's header (or floating in
   the corner if the header couldn't be found on that page).
   - Click it to export in the current default format.
   - Click the gear next to it to pick **PDF**, **Markdown**, or
     **Plain text** — picking one sets it as the new default and exports
     immediately.
   - **Markdown / Plain text** download immediately.
   - **PDF** opens a new tab formatted for printing and triggers your
     browser's print dialog — choose **"Save as PDF"** as the
     destination.
## How it works
 
- `content.js` runs on all three platforms. A `PlatformAdapters` object
  tells it, per site: how to find message elements, how to tell a user
  message from an assistant one, how to get the actual message content,
  and a `targetContainer` list of CSS selectors to try for where to dock
  the button.
- All file-generation and download logic (`downloadBlob`,
  `exportMarkdown`, `exportText`, `exportPdf`) lives in `content.js` now —
  there is no popup or background script left to own it.
- A `MutationObserver` on `document.documentElement` calls a debounced
  `ensureUIPresent()` on every DOM change; if the button's been removed
  from the page (or the node it's attached to went stale), it's rebuilt
  and re-inserted, re-checking `targetContainer` fresh each time. In
  practice this also means the button "upgrades" itself from the floating
  fallback into the docked header position automatically once that
  container shows up.
- No network requests are made by the extension itself, and no data
  leaves your machine.
## Adapters & selector caveats — please read
 
`targetContainer` selectors are **best-effort guesses**, not verified
against the live sites (I don't have a way to load an authenticated
ChatGPT/Claude/Gemini session to test against). All three platforms ship
heavily obfuscated, frequently-changing class names, so treat these as a
starting point:
 
```js
chatgpt: ['#conversation-header-actions', 'main header', 'header']
claude:  ['[data-testid="chat-controls"]', 'header']
gemini:  ['toolbar', 'header']
```
 
If the button keeps landing in the floating/bottom-right position on a
platform where you'd rather have it docked, open DevTools on that page,
inspect the header/toolbar you want it in, and add or reorder selectors
in that adapter's `targetContainer` array — first match wins. Because of
the floating fallback, a bad selector never breaks the extension, it just
means the button isn't docked.
 
The same caveat applies to `getMessageNodes` / `getRole` /
`getContentElement` for each adapter — these were carried over from an
earlier pass and are also guesses for Claude and Gemini specifically.
Gemini's adapter currently extracts plain text only (no formatting) since
its message content lives inside a shadow root.
 
## Limitations
 
- Selector fragility as described above — a platform redesign can require
  updating that platform's adapter in `content.js`.
- Images and other embedded media aren't downloaded — they're kept as
  links/references where the page includes them.
- Gemini export currently has no rich formatting (see above).
- Very long conversations produce very long PDFs; the print dialog can
  take a moment to render.
- Independent tool, not affiliated with or endorsed by OpenAI, Anthropic,
  or Google.
## File overview
 
```
chatgpt-exporter/
├── manifest.json   Extension config (Manifest V3, no popup)
├── content.js      Adapters, extraction, export logic, in-page UI, observer
├── content.css     Styling for the injected button/menu/toast
├── icons/          Toolbar icon
└── README.md
```
 