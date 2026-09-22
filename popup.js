const subline = document.getElementById('subline');
const statusEl = document.getElementById('status');
const rowButtons = Array.from(document.querySelectorAll('.row'));

let activeTabId = null;

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onChatGpt = tab && tab.url && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url);

  if (!onChatGpt) {
    subline.textContent = 'Open a ChatGPT conversation to export it';
    return;
  }

  activeTabId = tab.id;
  subline.textContent = 'Ready to export this conversation';
  setRowsEnabled(true);
  rowButtons.forEach((btn) => btn.addEventListener('click', () => handleExport(btn.dataset.format)));
}

function setRowsEnabled(enabled) {
  rowButtons.forEach((btn) => {
    btn.disabled = !enabled;
  });
}

async function getConversationData() {
  try {
    const res = await chrome.tabs.sendMessage(activeTabId, { type: 'EXTRACT_CONVERSATION' });
    if (res && res.ok) return res.data;
    throw new Error((res && res.error) || 'Could not read the page');
  } catch (err) {
    // The content script may not be injected yet (tab opened before the
    // extension was installed/reloaded). Inject it once and retry.
    await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ['content.js'] });
    const res = await chrome.tabs.sendMessage(activeTabId, { type: 'EXTRACT_CONVERSATION' });
    if (res && res.ok) return res.data;
    throw new Error((res && res.error) || 'Could not read the page');
  }
}

async function handleExport(format) {
  setStatus('Reading conversation…', null);
  setRowsEnabled(false);
  try {
    const data = await getConversationData();
    if (!data.messages.length) {
      setStatus('No messages found on this page yet.', 'error');
      return;
    }
    if (format === 'md') exportMarkdown(data);
    else if (format === 'txt') exportText(data);
    else if (format === 'pdf') exportPdf(data);
    setStatus('Export ready.', 'ok');
  } catch (err) {
    setStatus(err.message || 'Something went wrong.', 'error');
  } finally {
    setRowsEnabled(true);
  }
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ` status--${kind}` : '');
}

function roleLabel(role) {
  if (role === 'user') return 'You';
  if (role === 'assistant') return 'ChatGPT';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function safeFilename(title) {
  return title.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'chatgpt-conversation';
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportMarkdown(data) {
  const lines = [
    `# ${data.title}`,
    '',
    `_Exported ${new Date(data.exportedAt).toLocaleString()} from ${data.url}_`,
    '',
  ];
  data.messages.forEach((m) => {
    lines.push(`### ${roleLabel(m.role)}`, '', m.markdown, '');
  });
  downloadBlob(`${safeFilename(data.title)}.md`, lines.join('\n'), 'text/markdown');
}

function exportText(data) {
  const lines = [
    data.title,
    `Exported ${new Date(data.exportedAt).toLocaleString()} from ${data.url}`,
    '='.repeat(40),
    '',
  ];
  data.messages.forEach((m) => {
    lines.push(`${roleLabel(m.role).toUpperCase()}:`, m.text, '');
  });
  downloadBlob(`${safeFilename(data.title)}.txt`, lines.join('\n'), 'text/plain');
}

function exportPdf(data) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const body = data.messages
    .map(
      (m) => `
    <section class="msg msg--${esc(m.role)}">
      <div class="msg__role">${esc(roleLabel(m.role))}</div>
      <div class="msg__content">${m.html}</div>
    </section>`
    )
    .join('\n');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(data.title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1E2A32; max-width: 720px; margin: 40px auto; line-height: 1.55; padding: 0 24px; }
  h1 { font-size: 22px; margin-bottom: 2px; }
  .meta { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 11px; color: #55636B; margin-bottom: 28px; }
  .msg { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #D9D2C3; page-break-inside: avoid; }
  .msg__role { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.03em; color: #355E56; margin-bottom: 6px; }
  .msg--user .msg__role { color: #B8823B; }
  .msg__content pre { background: #F1ECDF; padding: 10px 12px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; }
  .msg__content code { font-family: 'SFMono-Regular', Consolas, monospace; }
  .msg__content img { max-width: 100%; }
  @media print { body { margin: 0 24px; } .msg { break-inside: avoid; } }
</style>
</head>
<body>
  <h1>${esc(data.title)}</h1>
  <div class="meta">Exported ${esc(new Date(data.exportedAt).toLocaleString())} &middot; ${esc(data.url)}</div>
  ${body}
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 300);
    });
  <\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url });
}
