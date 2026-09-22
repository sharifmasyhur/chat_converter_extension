// Conversation Archive — content script
// Runs on chatgpt.com / claude.ai / gemini.google.com. Reads the
// conversation already rendered on the page and injects an in-page
// export button; nothing is ever sent off the page.
 
(function () {
  'use strict';
 
  const ROOT_ID = 'cae-root';
  let defaultFormat = 'pdf';
 
  // ---------------------------------------------------------------------
  // HTML -> Markdown / plain-text rendering
  // (unchanged from the previous popup-based version — a single walker
  // handles both output modes so they can't drift apart)
  // ---------------------------------------------------------------------
 
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
 
  function getMessageContentElement(node, adapter) {
    let el = adapter.getContentElement(node);
    if (!el) el = node;
    const clone = el.cloneNode(true);
    clone
      .querySelectorAll('script, iframe, button, svg, [role="button"], .sr-only, [aria-hidden="true"]')
      .forEach((n) => n.remove());
    return clone;
  }
 
  function extractConversation(adapter) {
    const nodes = Array.from(adapter.getMessageNodes());
 
    let title = (document.title || '').trim();
    if (!title) title = `${adapter.name} Conversation`;
 
    const messages = nodes
      .map((node) => {
        const role = adapter.getRole(node) || 'unknown';
        const contentEl = getMessageContentElement(node, adapter);
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
 
  // ---------------------------------------------------------------------
  // Platform adapters
  //
  // `targetContainer` is an ordered list of CSS selectors to try, in
  // preference order, for where the button should live in that
  // platform's header/toolbar. These are best-effort — all three sites
  // ship heavily obfuscated, frequently-changing class names, so none of
  // these selectors are guaranteed to keep matching. If none of them
  // match (or the platform doesn't have a stable header container),
  // injectUI() falls back to a fixed floating button so the extension
  // never silently disappears — it just loses its "docked" placement.
  // ---------------------------------------------------------------------
 
  const PlatformAdapters = {
    chatgpt: {
      name: 'ChatGPT',
      detect: () => window.location.hostname.includes('chatgpt.com'),
      targetContainer: ['#conversation-header-actions', 'main header', 'header'],
      getMessageNodes: () => document.querySelectorAll('[data-message-author-role]'),
      getRole: (node) => node.getAttribute('data-message-author-role'),
      getContentElement: (node) => node.querySelector('.markdown') || node,
    },
    claude: {
      name: 'Claude',
      detect: () => window.location.hostname.includes('claude.ai'),
      targetContainer: ['[data-testid="chat-controls"]', 'header'],
      // Claude uses different structural classes, often nested within flex containers
      getMessageNodes: () => document.querySelectorAll('.font-claude-message'),
      getRole: (node) => (node.closest('.is-user') ? 'user' : 'assistant'),
      getContentElement: (node) => node.querySelector('.prose') || node,
    },
    gemini: {
      name: 'Gemini',
      detect: () => window.location.hostname.includes('gemini.google.com'),
      targetContainer: ['toolbar', 'header'],
      getMessageNodes: () => document.querySelectorAll('message-content'),
      getRole: (node) => (node.hasAttribute('is-user') ? 'user' : 'assistant'),
      getContentElement: (node) => {
        const root = node.shadowRoot || node;
        const wrapper = document.createElement('div');
        // Preserves all native HTML structure instead of flattening it to text
        wrapper.innerHTML = root.innerHTML;
        return wrapper;
      },
    },
  };
 
  function getShadowText(node) {
    const root = node.shadowRoot || node;
    let text = '';
    for (const child of root.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        text += getShadowText(child);
      }
    }
    return text;
  }
 
  function getActiveAdapter() {
    return Object.values(PlatformAdapters).find((adapter) => adapter.detect());
  }
 
  function findTargetContainer(adapter) {
    for (const selector of adapter.targetContainer || []) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }
 
  // ---------------------------------------------------------------------
  // Export / download logic (moved here from popup.js — the popup no
  // longer exists, this in-page button is the only UI now)
  // ---------------------------------------------------------------------
 
  function roleLabel(role, adapter) {
    if (role === 'user') return 'You';
    if (role === 'assistant') return adapter.name;
    return role.charAt(0).toUpperCase() + role.slice(1);
  }
 
  function safeFilename(title) {
    return title.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'conversation';
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
 
  function exportMarkdown(data, adapter) {
    const lines = [
      `# ${data.title}`,
      '',
      `_Exported ${new Date(data.exportedAt).toLocaleString()} from ${data.url}_`,
      '',
    ];
    data.messages.forEach((m) => {
      lines.push(`### ${roleLabel(m.role, adapter)}`, '', m.markdown, '');
    });
    downloadBlob(`${safeFilename(data.title)}.md`, lines.join('\n'), 'text/markdown');
  }
 
  function exportText(data, adapter) {
    const lines = [
      data.title,
      `Exported ${new Date(data.exportedAt).toLocaleString()} from ${data.url}`,
      '='.repeat(40),
      '',
    ];
    data.messages.forEach((m) => {
      lines.push(`${roleLabel(m.role, adapter).toUpperCase()}:`, m.text, '');
    });
    downloadBlob(`${safeFilename(data.title)}.txt`, lines.join('\n'), 'text/plain');
  }
 
 function exportPdf(data, adapter) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Build the styled HTML content
    const body = data.messages
      .map((m) => `
        <div style="margin-bottom: 24px; padding: 16px; border-radius: 8px; background: ${m.role === 'user' ? '#f8fafc' : '#ffffff'}; border: 1px solid ${m.role === 'user' ? '#e2e8f0' : '#cbd5e1'}; page-break-inside: avoid;">
          <div style="font-size: 11px; font-weight: bold; text-transform: uppercase; margin-bottom: 12px; color: #64748b; letter-spacing: 0.05em;">${esc(roleLabel(m.role, adapter))}</div>
          <div style="font-size: 13px; line-height: 1.6; color: #0f172a;">${m.html}</div>
        </div>
      `).join('\n');

    // Create a temporary container off-screen
    const container = document.createElement('div');
    container.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    container.style.padding = '20px';
    container.style.color = '#0f172a';
    container.innerHTML = `
      <h1 style="font-size: 20px; margin-bottom: 4px; font-weight: bold;">${esc(data.title)}</h1>
      <div style="font-size: 11px; color: #64748b; margin-bottom: 32px;">Exported ${esc(new Date(data.exportedAt).toLocaleString())} &middot; ${esc(data.url)}</div>
      ${body}
    `;

    // Configure and trigger the automatic silent download
    const opt = {
      margin:       10,
      filename:     `${safeFilename(data.title)}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(container).save();
  }
 
  const FORMATS = {
    pdf: { label: 'Save as PDF', run: exportPdf },
    md: { label: 'Save as Markdown', run: exportMarkdown },
    txt: { label: 'Save as text', run: exportText },
  };
 
  function runExport(format) {
    const adapter = getActiveAdapter();
    if (!adapter) {
      showToast('Unsupported page.', true);
      return;
    }
    try {
      const data = extractConversation(adapter);
      if (!data.messages.length) {
        showToast('No messages found on this page yet.', true);
        return;
      }
      FORMATS[format].run(data, adapter);
      showToast('Export ready.', false);
    } catch (err) {
      showToast((err && err.message) || 'Something went wrong.', true);
    }
  }
 
  // ---------------------------------------------------------------------
  // In-page UI: split button + dropdown, injected into the host page
  // ---------------------------------------------------------------------
 
  const ICON_DOWNLOAD =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v7"/><path d="M5 6.5 8 9.5 11 6.5"/><path d="M3 12.5h10"/></svg>';
  const ICON_GEAR =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.6" stroke-dasharray="2.4 2.8"/></svg>';
  const ICON_CHECK =
    '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4.5"/></svg>';
 
  const MENU_ITEMS = [
    { format: 'pdf', stamp: 'PDF', stampClass: 'cae-menu__stamp--pdf', title: 'Portable document', desc: 'Print-ready, opens a save dialog' },
    { format: 'md', stamp: 'MD', stampClass: 'cae-menu__stamp--md', title: 'Markdown', desc: 'Formatting kept, editable anywhere' },
    { format: 'txt', stamp: 'TXT', stampClass: 'cae-menu__stamp--txt', title: 'Plain text', desc: 'No styling, opens anywhere' },
  ];
 
  let toastTimer = null;
 
  function showToast(text, isError) {
    let toast = document.getElementById('cae-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cae-toast';
      toast.className = 'cae-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.toggle('is-error', !!isError);
    // Force reflow so the transition re-triggers on rapid repeat calls.
    // eslint-disable-next-line no-unused-expressions
    toast.offsetHeight;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }
 
  function buildRoot() {
    const root = document.createElement('div');
    root.id = ROOT_ID;
 
    root.innerHTML = `
      <div class="cae-split">
        <button type="button" class="cae-btn cae-btn--main" data-cae-main>
          ${ICON_DOWNLOAD}<span data-cae-main-label>${FORMATS[defaultFormat].label}</span>
        </button>
        <button type="button" class="cae-btn cae-btn--gear" aria-haspopup="true" aria-expanded="false" title="Export options" data-cae-gear>
          ${ICON_GEAR}
        </button>
      </div>
      <div class="cae-menu" role="menu" hidden data-cae-menu>
        ${MENU_ITEMS.map(
          (item) => `
          <button type="button" class="cae-menu__item" role="menuitemradio" data-format="${item.format}">
            <span class="cae-menu__stamp ${item.stampClass}">${item.stamp}</span>
            <span class="cae-menu__text">
              <span class="cae-menu__title">${item.title}</span>
              <span class="cae-menu__desc">${item.desc}</span>
            </span>
            <span class="cae-menu__check">${ICON_CHECK}</span>
          </button>`
        ).join('')}
      </div>
    `;
 
    const mainBtn = root.querySelector('[data-cae-main]');
    const gearBtn = root.querySelector('[data-cae-gear]');
    const menu = root.querySelector('[data-cae-menu]');
    const mainLabel = root.querySelector('[data-cae-main-label]');
 
    function setSelected(format) {
      root.querySelectorAll('.cae-menu__item').forEach((btn) => {
        btn.classList.toggle('is-selected', btn.dataset.format === format);
      });
    }
    setSelected(defaultFormat);
 
    function closeMenu() {
      menu.hidden = true;
      gearBtn.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
      menu.hidden = false;
      gearBtn.setAttribute('aria-expanded', 'true');
    }
 
    mainBtn.addEventListener('click', () => runExport(defaultFormat));
 
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });
 
    menu.querySelectorAll('.cae-menu__item').forEach((btn) => {
      btn.addEventListener('click', () => {
        defaultFormat = btn.dataset.format;
        mainLabel.textContent = FORMATS[defaultFormat].label;
        setSelected(defaultFormat);
        closeMenu();
        runExport(defaultFormat);
      });
    });
 
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
 
    return root;
  }
 
  function injectUI() {
    if (document.getElementById(ROOT_ID)) return; // already present
 
    const adapter = getActiveAdapter();
    if (!adapter) return;
 
    const root = buildRoot();
    const container = findTargetContainer(adapter);
 
    if (container) {
      root.classList.add('cae-root--inline');
      container.appendChild(root);
    } else {
      root.classList.add('cae-root--floating');
      document.body.appendChild(root);
    }
  }
 
  function ensureUIPresent() {
    const existing = document.getElementById(ROOT_ID);
    if (existing && existing.isConnected) return;
    if (existing) existing.remove(); // detached node left behind by a re-render
    injectUI();
  }
 
  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }
 
  // ChatGPT/Claude/Gemini are all SPAs that re-render large parts of the
  // DOM (including the header) on navigation and even mid-stream while a
  // reply is being written. Debounced so it doesn't run on every single
  // mutation during a streaming response.
  const scheduleEnsure = debounce(ensureUIPresent, 200);
  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, { childList: true, subtree: true });
 
  ensureUIPresent();
 
  // Kept for compatibility / debugging — no popup calls this anymore,
  // but it's a harmless way to pull the extracted conversation from
  // the extension's service worker or DevTools if needed later.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'EXTRACT_CONVERSATION') {
      try {
        const adapter = getActiveAdapter();
        if (!adapter) throw new Error('Unsupported platform');
        sendResponse({ ok: true, data: extractConversation(adapter) });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    }
    return true;
  });
})();
 