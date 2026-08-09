import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { waitForEval } from './helpers/appActions.mjs'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const DEBUG_PORT = Number(process.env.CDP_CONVERSATION_EXPORT_PORT || 9343)

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const mockScript = `
(() => {
  const conversations = new Map([
    ['export-cdp-1', {
      id: 'export-cdp-1',
      title: 'Alpha Export',
      createdAt: '2026-05-26T00:00:00.000Z',
      updatedAt: '2026-05-26T00:03:00.000Z',
      titleManuallyEdited: true,
      messages: [
        { role: 'user', content: 'export markdown question' },
        {
          role: 'assistant',
          content: 'export markdown answer',
          reasoningContent: 'export markdown reasoning',
          reasoningDurationMs: 88
        }
      ]
    }],
    ['export-cdp-2', {
      id: 'export-cdp-2',
      title: 'Beta Export',
      createdAt: '2026-05-26T00:00:00.000Z',
      updatedAt: '2026-05-26T00:02:00.000Z',
      titleManuallyEdited: true,
      messages: [
        { role: 'assistant', content: 'backup answer', reasoningContent: 'backup reasoning', reasoningDurationMs: 5 }
      ]
    }]
  ]);
  const exportRequests = [];
  const detailRequests = [];
  const askRequests = [];
  const objectUrls = new Map();
  const downloads = [];
  const revokedUrls = [];
  let blobIndex = 0;

  function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers }
    });
  }

  function text(data, status = 200, headers = {}) {
    return new Response(data, {
      status,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', ...headers }
    });
  }

  function summary(conversation) {
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length
    };
  }

  URL.createObjectURL = (blob) => {
    const url = 'blob:mock-download-' + ++blobIndex;
    objectUrls.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    revokedUrls.push(url);
  };

  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.href.startsWith('blob:mock-download-')) {
      downloads.push({ download: this.download, href: this.href });
      return;
    }

    return originalAnchorClick.call(this);
  };

  window.__conversationExportState = async () => ({
    exportRequests: exportRequests.slice(),
    detailRequests: detailRequests.slice(),
    askRequests: askRequests.slice(),
    revokedUrls: revokedUrls.slice(),
    downloads: await Promise.all(downloads.map(async (item) => ({
      ...item,
      text: await objectUrls.get(item.href)?.text()
    }))),
    noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth
  });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const parsed = new URL(url, window.location.origin);
    const pathname = parsed.pathname.replace(/^\\/api/, '');
    const method = (init.method || 'GET').toUpperCase();

    if (pathname === '/conversations' && method === 'GET') {
      return json({
        conversations: [...conversations.values()]
          .map(summary)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      });
    }

    if (pathname === '/conversations/export.json' && method === 'GET') {
      exportRequests.push('all-json');
      await new Promise((resolve) => setTimeout(resolve, 180));
      return json({
        schemaVersion: 1,
        source: 'chatbot-local',
        exportedAt: '2026-05-26T00:04:00.000Z',
        conversations: [...conversations.values()]
      }, 200, {
        'Content-Disposition': 'attachment; filename="chatbot-conversations-2026-05-26.json"'
      });
    }

    const markdownMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/export\\.md$/);
    if (markdownMatch && method === 'GET') {
      const id = decodeURIComponent(markdownMatch[1]);
      exportRequests.push('markdown:' + id);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const conversation = conversations.get(id);
      if (!conversation) return json({ message: 'not found' }, 404);
      return text([
        '# ' + conversation.title,
        '',
        'export markdown question',
        '',
        '<summary>思考过程 (88ms)</summary>',
        '',
        'export markdown reasoning',
        '',
        'export markdown answer'
      ].join('\\n'), 200, {
        'Content-Disposition': 'attachment; filename="alpha-export.md"'
      });
    }

    const detailMatch = pathname.match(/^\\/conversations\\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const id = decodeURIComponent(detailMatch[1]);
      const conversation = conversations.get(id);
      detailRequests.push(id);
      return conversation ? json({ conversation }) : json({ message: 'not found' }, 404);
    }

    const askMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/ask$/);
    if (askMatch) {
      askRequests.push(decodeURIComponent(askMatch[1]));
      return json({ message: 'ask should not be called in export test' }, 500);
    }

    if (pathname.startsWith('/requests/') && pathname.endsWith('/cancel') && method === 'POST') {
      return json({ cancelled: true });
    }

    return json({ message: 'unexpected mock route: ' + method + ' ' + pathname }, 500);
  };
})();
`

async function clickConversationExport(client, title, clickCount = 1) {
  const usesPopup = await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')]
        .find((item) => item.innerText.includes(${JSON.stringify(title)}));
      if (!shell) throw new Error('conversation shell not found: ${title}');
      const trigger = shell.querySelector('.conversation-menu-trigger');
      if (trigger) {
        trigger.click();
        return true;
      }
      return false;
    })()`,
  )
  if (usesPopup) {
    await waitForEval(client, `Boolean(document.querySelector('.conversation-actions-menu'))`)
  }
  await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')]
        .find((item) => item.innerText.includes(${JSON.stringify(title)}));
      const root = document.querySelector('.conversation-actions-menu') || shell;
      const button = [...root.querySelectorAll('.conversation-action-btn')]
        .find((item) => item.textContent.trim() === '导出');
      if (!button) throw new Error('export button not found: ${title}');
      for (let index = 0; index < ${clickCount}; index += 1) button.click();
    })()`
  )
}

async function clickButtonByText(client, text, clickCount = 1) {
  if (text === '导出全部 JSON') {
    const usesUserMenu = await evaluate(
      client,
      `(() => {
        const trigger = document.querySelector('.user-menu-trigger');
        if (!trigger) return false;
        trigger.click();
        return true;
      })()`,
    )
    if (usesUserMenu) {
      await waitForEval(client, `Boolean(document.querySelector('.sidebar-user-menu'))`)
    }
  }
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) =>
          item.textContent.trim() === ${JSON.stringify(text)} ||
          item.getAttribute('aria-label') === ${JSON.stringify(text)}
        );
      if (!button) throw new Error('button not found: ${text}');
      for (let index = 0; index < ${clickCount}; index += 1) button.click();
    })()`
  )
}

async function readExportState(client) {
  return evaluate(client, `window.__conversationExportState()`)
}

async function main() {
  const { chrome } = await launchChrome({
    url: 'about:blank',
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-conversation-export-',
    windowSize: '1280,900'
  })
  let client

  try {
    const target = await getPageTarget(DEBUG_PORT, 'about:blank')
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript })
    await client.send('Page.navigate', { url: APP_URL })
    await waitForEval(client, `document.readyState === 'complete' && document.body.innerText.includes('Alpha Export')`)

    await clickConversationExport(client, 'Alpha Export', 3)
    await waitForEval(
      client,
      `(() => {
        const button = [...document.querySelectorAll('.conversation-action-btn')]
          .find((item) => item.textContent.trim() === '导出中...');
        return Boolean(button?.matches(':disabled, [data-disabled], [aria-disabled="true"]')) &&
          button.getAttribute('aria-busy') === 'true';
      })()`
    )
    const singleBusyState = await readExportState(client)
    assert(
      singleBusyState.exportRequests.filter((item) => item === 'markdown:export-cdp-1').length === 1,
      'rapid single export clicks created duplicate requests'
    )
    await waitForEval(client, `window.__conversationExportState().then((state) => state.downloads.length === 1)`)
    await waitForEval(
      client,
      `[...document.querySelectorAll('.conversation-action-btn')]
        .some((item) =>
          item.textContent.trim() === '导出' &&
          !item.matches(':disabled, [data-disabled], [aria-disabled="true"]')
        )`
    )
    let state = await readExportState(client)
    assert(state.exportRequests.includes('markdown:export-cdp-1'), 'single conversation export endpoint was not called')
    assert(state.downloads[0]?.download === 'alpha-export.md', 'single conversation export filename was not used')
    assert(state.downloads[0]?.text.includes('export markdown reasoning'), 'markdown export did not include reasoning text')
    assert(state.downloads[0]?.text.includes('export markdown answer'), 'markdown export did not include answer text')
    assert(state.revokedUrls.includes(state.downloads[0].href), 'single conversation object URL was not revoked')

    await clickButtonByText(client, '导出全部 JSON', 3)
    await waitForEval(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.textContent.trim() === '导出中...');
        return Boolean(button?.matches(':disabled, [data-disabled], [aria-disabled="true"]')) &&
          button.getAttribute('aria-busy') === 'true';
      })()`
    )
    const allBusyState = await readExportState(client)
    assert(
      allBusyState.exportRequests.filter((item) => item === 'all-json').length === 1,
      'rapid full export clicks created duplicate requests'
    )
    await waitForEval(client, `window.__conversationExportState().then((state) => state.downloads.length === 2)`)
    await waitForEval(
      client,
      `[...document.querySelectorAll('button')]
        .some((item) =>
          item.textContent.trim() === '导出全部 JSON' &&
          !item.matches(':disabled, [data-disabled], [aria-disabled="true"]')
        )`
    )
    state = await readExportState(client)
    assert(state.exportRequests.includes('all-json'), 'all conversations export endpoint was not called')
    assert(state.downloads[1]?.download === 'chatbot-conversations-2026-05-26.json', 'json export filename was not used')
    const backup = JSON.parse(state.downloads[1].text)
    assert(backup.schemaVersion === 1, 'json export schema version missing')
    assert(backup.conversations.length === 2, 'json export did not include all conversations')
    assert(
      backup.conversations.some((conversation) =>
        conversation.messages.some((message) => message.reasoningContent === 'backup reasoning')
      ),
      'json export did not preserve reasoning fields'
    )
    assert(state.askRequests.length === 0, 'export flow unexpectedly called ask endpoint')

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 820,
      deviceScaleFactor: 1,
      mobile: true
    })
    await waitForEval(client, `document.documentElement.scrollWidth <= window.innerWidth`)
    state = await readExportState(client)
    assert(state.noPageOverflow, 'export controls caused page-level horizontal overflow on mobile')

    console.log(JSON.stringify({
      allPassed: true,
      assertions: {
        ...state,
        rapidSingleRequestCount: singleBusyState.exportRequests.length,
        rapidAllRequestCount: allBusyState.exportRequests.filter((item) => item === 'all-json').length,
        loadingStatesVisible: true,
        controlsRecovered: true
      }
    }, null, 2))
  } finally {
    client?.close()
    await stopProcess(chrome)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
