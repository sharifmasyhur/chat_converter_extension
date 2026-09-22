// Conversation Archive for ChatGPT — content script
// Runs on chatgpt.com / chat.openai.com. Reads the conversation already
// rendered on the page; never sends anything off the page.

/**
 * Renders one DOM node to either 'md' (Markdown) or 'txt' (plain text).
 * A single walker handles both so the two outputs never drift apart.
 */
function renderNode(node, mode) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  const children = () => Array.from(node.childNodes).map((c) => renderNode(c, mode)).join('');

  switch (tag) {
    case 'p':
      return children().trim() + '\n\n';
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
      return mode === 'md' ? `**${children()}**` : children();
    case 'em':
    case 'i':
      return mode === 'md' ? `_${children()}_` : children();
    case 'code': {
      if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
        return children();
      }
      return mode === 'md' ? `\`${children()}\`` : children();
    }
    case 'pre': {
      const codeEl = node.querySelector('code');
      const raw = (codeEl || node).textContent.replace(/\n$/, '');
      let lang = '';
      if (codeEl) {
        const m = (codeEl.className || '').match(/language-(\w+)/);
        if (m) lang = m[1];
      }
      if (mode === 'md') {
        return '```' + lang + '\n' + raw + '\n```\n\n';
      }
      return raw.split('\n').map((l) => '    ' + l).join('\n') + '\n\n';
    }
    case 'ul':
    case 'ol':
      return Array.from(node.children).map((li) => renderNode(li, mode)).join('') + '\n';
    case 'li': {
      const parent = node.parentElement;
      const isOrdered = parent && parent.tagName.toLowerCase() === 'ol';
      const prefix = isOrdered
        ? `${Array.from(parent.children).indexOf(node) + 1}. `
        : mode === 'md' ? '- ' : '• ';
      return prefix + children().trim() + '\n';
    }
    case 'a': {
      const href = node.getAttribute('href') || '';
      const text = children();
      return mode === 'md' && href ? `[${text}](${href})` : text;
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = parseInt(tag[1], 10);
      if (mode === 'md') return '#'.repeat(level) + ' ' + children().trim() + '\n\n';
      return children().trim().toUpperCase() + '\n\n';
    }
    case 'blockquote': {
      const inner = children().trim();
      const marker = mode === 'md' ? '> ' : '| ';
      return inner.split('\n').map((l) => marker + l).join('\n') + '\n\n';
    }
    case 'table': {
      const rows = Array.from(node.querySelectorAll('tr'));
      let out = '';
      rows.forEach((row, ri) => {
        const cells = Array.from(row.children).map((c) => renderNode(c, mode).trim().replace(/\|/g, '\\|'));
        out += '| ' + cells.join(' | ') + ' |\n';
        if (ri === 0 && mode === 'md') {
          out += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
        }
      });
      return out + '\n';
    }
    case 'hr':
      return mode === 'md' ? '\n---\n\n' : '\n----------\n\n';
    case 'script':
    case 'style':
      return '';
    default:
      return children();
  }
}

function htmlFragmentTo(mode, containerEl) {
  const raw = Array.from(containerEl.childNodes).map((c) => renderNode(c, mode)).join('');
  return raw.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Finds the meaningful content element within one message bubble and
 * returns a cleaned clone (UI chrome like copy/thumbs buttons removed,
 * scripts/iframes stripped for safety).
 */
function getMessageContentElement(node) {
  let el = node.querySelector('.markdown') || node.querySelector('[class*="whitespace-pre-wrap"]');
  if (!el) el = node;
  const clone = el.cloneNode(true);
  clone
    .querySelectorAll('script, iframe, button, svg, [role="button"], .sr-only, [aria-hidden="true"]')
    .forEach((n) => n.remove());
  return clone;
}

function extractConversation() {
  const nodes = Array.from(document.querySelectorAll('[data-message-author-role]'));

  let title = (document.title || '').replace(/^ChatGPT\s*-?\s*/i, '').trim();
  if (!title) title = 'ChatGPT Conversation';

  const messages = nodes
    .map((node) => {
      const role = node.getAttribute('data-message-author-role') || 'unknown';
      const contentEl = getMessageContentElement(node);
      return {
        role,
        html: contentEl.innerHTML,
        markdown: htmlFragmentTo('md', contentEl),
        text: htmlFragmentTo('txt', contentEl),
      };
    })
    .filter((m) => m.text.trim().length > 0 || m.markdown.trim().length > 0);

  return {
    title,
    url: location.href,
    exportedAt: new Date().toISOString(),
    messages,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'EXTRACT_CONVERSATION') {
    try {
      sendResponse({ ok: true, data: extractConversation() });
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  }
  return true;
});
