# Conversation Archive for ChatGPT

A small browser extension that saves your ChatGPT conversation as a PDF,
Markdown (`.md`), or plain text (`.txt`) file. Everything runs locally in
your browser — the extension reads the conversation already on the page
and never sends it anywhere.

Works in any Chromium-based browser: **Chrome, Opera GX, Edge, Brave,**
etc.

## Install (unpacked / developer mode)

Chrome Web Store review is for public listings; loading it as an
"unpacked" extension is instant and works the same way for testing or
personal use.

1. Unzip this folder somewhere permanent (don't delete it later — the
   browser loads the extension from this folder each time it starts).
2. Open `chrome://extensions` (Opera GX: `opera://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped `chatgpt-exporter`
   folder.
5. Pin it to the toolbar (puzzle-piece icon → the pin next to
   "Conversation Archive") so it's one click away.

## Use it

1. Open a conversation on `chatgpt.com` (or `chatgpt.com`).
2. Click the extension icon.
3. Pick **PDF**, **Markdown**, or **Plain text**.
   - **Markdown / Plain text** download immediately.
   - **PDF** opens a new tab formatted for printing and triggers your
     browser's print dialog — choose **"Save as PDF"** as the
     destination.

## How it works

- `content.js` runs on ChatGPT pages and reads the messages that are
  already rendered in the DOM (it does not call any API or re-fetch the
  conversation).
- `popup.js` asks the content script for the conversation, then builds
  the file you asked for and triggers a normal browser download (or, for
  PDF, opens a print-ready tab).
- No network requests are made by the extension itself, and no data
  leaves your machine.

## Limitations

- ChatGPT's page structure changes from time to time. This extension
  looks for OpenAI's `data-message-author-role` attribute, which has
  been stable for a long while, but a future redesign could require a
  selector update in `content.js`.
- Images and other embedded media are not downloaded — they're kept as
  links/references where the page includes them.
- Very long conversations produce very long PDFs; the print dialog can
  take a moment to render.
- This is an independent tool and isn't affiliated with or endorsed by
  OpenAI or Anthropic.

## File overview

```
chatgpt-exporter/
├── manifest.json     Extension config (Manifest V3)
├── content.js        Reads & converts the conversation on the page
├── popup.html/.css/.js  Toolbar popup UI and export logic
├── icons/            Toolbar icons
└── README.md
```
