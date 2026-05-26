import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { screenshot, waitForEval } from './helpers/appActions.mjs'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const DEBUG_PORT = Number(process.env.CDP_CONVERSATION_SEARCH_PORT || 9342)
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-conversation-search-screenshots')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const mockScript = `
(() => {
  const conversations = new Map([
    ['search-cdp-1', {
      id: 'search-cdp-1',
      title: 'Alpha Roadmap',
      createdAt: '2026-05-26T00:00:00.000Z',
      updatedAt: '2026-05-26T00:03:00.000Z',
      titleManuallyEdited: true,
      messages: [
        { role: 'user', content: '标题命中会话内容' }
      ]
    }],
    ['search-cdp-2', {
      id: 'search-cdp-2',
      title: 'Beta Notes',
      createdAt: '2026-05-26T00:00:00.000Z',
      updatedAt: '2026-05-26T00:02:00.000Z',
      titleManuallyEdited: true,
      messages: [
        { role: 'assistant', content: '这里有 needle-message-snippet 用于消息内容搜索' }
      ]
    }],
    ['search-cdp-3', {
      id: 'search-cdp-3',
      title: 'Gamma Special',
      createdAt: '2026-05-26T00:00:00.000Z',
      updatedAt: '2026-05-26T00:01:00.000Z',
      titleManuallyEdited: true,
      messages: [
        { role: 'user', content: '特殊字符 [a+b]? 也能搜索' }
      ]
    }]
  ]);
  const searchRequests = [];
  const detailRequests = [];
  const askRequests = [];
  let activeSearchCount = 0;

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
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

  function search(query) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    const results = [];
    for (const conversation of conversations.values()) {
      if (conversation.title.toLowerCase().includes(normalizedQuery)) {
        results.push({
          ...summary(conversation),
          matchedIn: 'title',
          snippet: conversation.title
        });
        continue;
      }

      const message = conversation.messages.find((item) =>
        item.content.toLowerCase().includes(normalizedQuery)
      );
      if (message) {
        results.push({
          ...summary(conversation),
          matchedIn: 'message',
          snippet: message.content
        });
      }
    }

    return results.sort((left, right) => {
      if (left.matchedIn !== right.matchedIn) return left.matchedIn === 'title' ? -1 : 1;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }

  window.__conversationSearchState = () => ({
    searchRequests: searchRequests.slice(),
    detailRequests: detailRequests.slice(),
    askRequests: askRequests.slice(),
    activeSearchCount,
    conversations: [...conversations.values()].map((conversation) => ({
      ...summary(conversation),
      messages: conversation.messages.map((message) => ({ ...message }))
    }))
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

    if (pathname === '/conversations/search' && method === 'GET') {
      const query = parsed.searchParams.get('q') || '';
      searchRequests.push(query);
      if (!query.trim()) return json({ message: '搜索关键词不能为空' }, 400);
      activeSearchCount += 1;
      try {
        if (query === 'fail-search') {
          return json({ message: 'mock search failure' }, 500);
        }

        if (query === 'alpha-slow') {
          await new Promise((resolve) => setTimeout(resolve, 250));
          return json({
            conversations: [{
              ...summary(conversations.get('search-cdp-1')),
              matchedIn: 'title',
              snippet: 'Alpha Roadmap'
            }]
          });
        }

        return json({ conversations: search(query) });
      } finally {
        activeSearchCount -= 1;
      }
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
      return json({ message: 'ask should not be called in search test' }, 500);
    }

    if (pathname.startsWith('/requests/') && pathname.endsWith('/cancel') && method === 'POST') {
      return json({ cancelled: true });
    }

    return json({ message: 'unexpected mock route: ' + method + ' ' + pathname }, 500);
  };
})();
`

async function setSearchQuery(client, query) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('.conversation-search-input');
      if (!input) throw new Error('search input not found');
      input.value = ${JSON.stringify(query)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`
  )
}

async function clickConversation(client, title) {
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('.conversation-item')]
        .find((item) => item.innerText.includes(${JSON.stringify(title)}));
      if (!button) throw new Error('conversation not found: ${title}');
      button.click();
    })()`
  )
}

async function readSidebarState(client) {
  return evaluate(
    client,
    `(() => {
      const state = window.__conversationSearchState();
      return {
        titles: [...document.querySelectorAll('.conversation-title')].map((item) => item.textContent.trim()),
        matches: [...document.querySelectorAll('.conversation-match')].map((item) => item.textContent.trim()),
        snippets: [...document.querySelectorAll('.conversation-snippet')].map((item) => item.textContent.trim()),
        emptyText: document.querySelector('.empty-sidebar-state')?.textContent.trim() || '',
        statusText: document.querySelector('.conversation-search-status')?.textContent.trim() || '',
        statusIsError: Boolean(document.querySelector('.conversation-search-status.error')),
        messageText: [...document.querySelectorAll('.message-text')].map((item) => item.textContent.trim()).join('\\n'),
        searchRequests: state.searchRequests,
        detailRequests: state.detailRequests,
        askRequests: state.askRequests,
        activeSearchCount: state.activeSearchCount,
        storedMessageCounts: state.conversations.map((conversation) => conversation.messages.length),
        noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth
      };
    })()`
  )
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const { chrome } = await launchChrome({
    url: 'about:blank',
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-conversation-search-',
    windowSize: '1280,900'
  })
  let client
  const screenshots = []

  try {
    const target = await getPageTarget(DEBUG_PORT, 'about:blank')
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript })
    await client.send('Page.navigate', { url: APP_URL })
    await waitForEval(client, `document.readyState === 'complete' && Boolean(document.querySelector('.conversation-search-input'))`)

    let state = await readSidebarState(client)
    assert(state.titles.join('|') === 'Alpha Roadmap|Beta Notes|Gamma Special', 'default conversation ordering changed')
    screenshots.push(await screenshot(client, OUT_DIR, '01-default-list', CAPTURE_SCREENSHOTS))

    await setSearchQuery(client, 'alpha')
    await waitForEval(client, `document.querySelectorAll('.conversation-title').length === 1 && document.body.innerText.includes('Alpha Roadmap')`)
    state = await readSidebarState(client)
    assert(state.titles.length === 1 && state.titles[0] === 'Alpha Roadmap', 'title search did not filter to Alpha Roadmap')
    assert(state.matches.includes('标题匹配'), 'title search did not show title match label')
    screenshots.push(await screenshot(client, OUT_DIR, '02-title-search', CAPTURE_SCREENSHOTS))

    await setSearchQuery(client, 'needle-message-snippet')
    await waitForEval(client, `document.body.innerText.includes('Beta Notes') && document.body.innerText.includes('needle-message-snippet')`)
    state = await readSidebarState(client)
    assert(state.titles.length === 1 && state.titles[0] === 'Beta Notes', 'message search did not filter to Beta Notes')
    assert(state.matches.includes('消息匹配'), 'message search did not show message match label')
    assert(state.snippets.some((snippet) => snippet.includes('needle-message-snippet')), 'message search snippet missing')
    screenshots.push(await screenshot(client, OUT_DIR, '03-message-search', CAPTURE_SCREENSHOTS))

    await clickConversation(client, 'Beta Notes')
    await waitForEval(client, `document.querySelector('.message-text')?.textContent.includes('needle-message-snippet')`)
    state = await readSidebarState(client)
    assert(state.messageText.includes('needle-message-snippet'), 'clicking search result did not open matching conversation')
    screenshots.push(await screenshot(client, OUT_DIR, '04-open-result', CAPTURE_SCREENSHOTS))

    await setSearchQuery(client, '[a+b]?')
    await waitForEval(client, `document.body.innerText.includes('Gamma Special')`)
    state = await readSidebarState(client)
    assert(state.titles.length === 1 && state.titles[0] === 'Gamma Special', 'special-character search failed')
    screenshots.push(await screenshot(client, OUT_DIR, '05-special-character-search', CAPTURE_SCREENSHOTS))

    await setSearchQuery(client, 'no-match-token')
    await waitForEval(client, `document.querySelector('.empty-sidebar-state')?.textContent.includes('无匹配会话')`)
    state = await readSidebarState(client)
    assert(state.titles.length === 0, 'no-result search still showed conversation items')
    assert(state.emptyText === '无匹配会话', 'no-result search did not show empty result text')
    screenshots.push(await screenshot(client, OUT_DIR, '06-no-results', CAPTURE_SCREENSHOTS))

    await setSearchQuery(client, 'fail-search')
    await waitForEval(client, `document.querySelector('.conversation-search-status.error')?.textContent.includes('搜索失败')`)
    state = await readSidebarState(client)
    assert(state.statusIsError, 'failed search did not expose an error state')
    assert(state.statusText === '搜索失败', 'failed search did not show the expected error message')
    assert(state.titles.length === 0, 'failed search should clear stale results')
    screenshots.push(await screenshot(client, OUT_DIR, '07-search-error', CAPTURE_SCREENSHOTS))

    await setSearchQuery(client, 'alpha-slow')
    await setSearchQuery(client, 'needle-message-snippet')
    await waitForEval(client, `document.body.innerText.includes('Beta Notes')`)
    await waitForEval(client, `window.__conversationSearchState().activeSearchCount === 0`)
    state = await readSidebarState(client)
    assert(state.titles.length === 1 && state.titles[0] === 'Beta Notes', 'stale slow search response overwrote the latest results')
    assert(state.searchRequests.includes('alpha-slow'), 'slow search request was not issued')
    assert(state.searchRequests.includes('needle-message-snippet'), 'latest search request was not issued')
    screenshots.push(await screenshot(client, OUT_DIR, '08-race-latest-result', CAPTURE_SCREENSHOTS))

    await setSearchQuery(client, '')
    await waitForEval(client, `document.querySelectorAll('.conversation-title').length === 3`)
    state = await readSidebarState(client)
    assert(state.titles.length === 3, 'clearing search did not restore the full conversation list')
    assert(state.statusText === '', 'clearing search did not clear status text')
    assert(state.askRequests.length === 0, 'search flow unexpectedly called ask endpoint')
    assert(state.storedMessageCounts.every((count) => count === 1), 'search flow mutated stored messages')

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 820,
      deviceScaleFactor: 1,
      mobile: true
    })
    await setSearchQuery(client, 'needle-message-snippet')
    await waitForEval(client, `document.body.innerText.includes('Beta Notes')`)
    state = await readSidebarState(client)
    assert(state.noPageOverflow, 'mobile search UI caused page-level horizontal overflow')
    screenshots.push(await screenshot(client, OUT_DIR, '09-mobile-message-search', CAPTURE_SCREENSHOTS))

    console.log(JSON.stringify({
      allPassed: true,
      screenshots: screenshots.filter(Boolean),
      assertions: state
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
