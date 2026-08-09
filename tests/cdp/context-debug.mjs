import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { screenshot, waitForEval } from './helpers/appActions.mjs'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const DEBUG_PORT = Number(process.env.CDP_CONTEXT_DEBUG_PORT || 9341)
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-context-debug-screenshots')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const mockScript = `
(() => {
  const conversations = new Map([
    ['context-cdp-1', {
      id: 'context-cdp-1',
      title: '上下文调试测试',
      createdAt: '2026-05-26T00:00:00.000Z',
      updatedAt: '2026-05-26T00:00:00.000Z',
      titleManuallyEdited: true,
      messages: [
        { role: 'user', content: 'OLD_DROPPED_CONTEXT_MESSAGE' },
        { role: 'assistant', content: 'KEEP_SELECTED_ASSISTANT' },
        { role: 'user', content: 'KEEP_SELECTED_USER' }
      ]
    }]
  ]);
  const contextPreviewRequests = [];

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

  function buildContextPreview(conversation, question) {
    const selectedHistory = conversation.messages.slice(-2);
    return {
      conversationId: conversation.id,
      question,
      messages: [
        { role: 'system', content: '你是一个中文智能助手，请使用中文回答用户的问题。' },
        ...selectedHistory.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: question }
      ],
      stats: {
        totalHistoryMessages: conversation.messages.length,
        selectedHistoryMessages: selectedHistory.length,
        droppedHistoryMessages: conversation.messages.length - selectedHistory.length,
        selectedHistoryChars: selectedHistory.reduce((total, message) => total + message.content.length, 0),
        maxHistoryMessages: 2,
        maxHistoryChars: 1000,
        summaryIncluded: false
      },
      model: {
        provider: 'deepseek',
        model: 'context-debug-model',
        endpointConfigured: true,
        apiKeyConfigured: true,
        reasoningEnabled: true,
        reasoningEffort: 'max',
        stream: true,
        toolChoice: 'auto',
        storageBackend: 'file',
        temperature: null,
        maxTokens: null
      },
      tools: {
        count: 3,
        definitions: [
          {
            type: 'function',
            function: {
              name: 'getWeather',
              description: '获取指定中文城市在今天、明天或后天的天气信息。'
            }
          }
        ]
      }
    };
  }

  window.__contextDebugState = () => ({
    conversations: [...conversations.values()].map((conversation) => ({
      ...summary(conversation),
      messages: conversation.messages.map((message) => ({ ...message }))
    })),
    contextPreviewRequests: contextPreviewRequests.slice()
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

    if (pathname === '/conversations' && method === 'POST') {
      return json({ message: 'new chat is not used in this test' }, 500);
    }

    const contextPreviewMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/context-preview$/);
    if (contextPreviewMatch && method === 'POST') {
      const conversation = conversations.get(decodeURIComponent(contextPreviewMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      const body = JSON.parse(init.body || '{}');
      const question = typeof body.question === 'string' ? body.question : '';
      contextPreviewRequests.push({ conversationId: conversation.id, question });
      return json({ context: buildContextPreview(conversation, question) });
    }

    const detailMatch = pathname.match(/^\\/conversations\\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      return conversation ? json({ conversation }) : json({ message: 'not found' }, 404);
    }

    if (pathname.startsWith('/requests/') && pathname.endsWith('/cancel') && method === 'POST') {
      return json({ cancelled: true });
    }

    return json({ message: 'unexpected mock route: ' + method + ' ' + pathname }, 500);
  };
})();
`

async function clickButtonByText(client, text) {
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) =>
          item.textContent.trim() === ${JSON.stringify(text)} ||
          item.getAttribute('aria-label') === ${JSON.stringify(text)}
        );
      if (!button) throw new Error('button not found: ${text}');
      button.click();
    })()`
  )
}

async function clickAppAction(client, text) {
  const clickedDirectly = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.textContent.trim() === ${JSON.stringify(text)});
      if (!button) return false;
      button.click();
      return true;
    })()`,
  )
  if (clickedDirectly) return

  await clickButtonByText(client, '更多操作')
  await waitForEval(
    client,
    `[...document.querySelectorAll('.app-actions-menu button')]
      .some((item) => item.textContent.trim() === ${JSON.stringify(text)})`,
  )
  await clickButtonByText(client, text)
}

async function typeQuestion(client, question) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('textarea');
      if (!input) throw new Error('textarea not found');
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      valueSetter.call(input, ${JSON.stringify(question)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`
  )
}

async function readModalState(client) {
  return evaluate(
    client,
    `(() => {
      const modal = document.querySelector('.context-debug-modal');
      const text = modal?.innerText || '';
      const state = window.__contextDebugState();
      return {
        hasModal: Boolean(modal),
        hasQuestion: text.includes('CURRENT_DEBUG_QUESTION'),
        hasSelectedAssistant: text.includes('KEEP_SELECTED_ASSISTANT'),
        hasSelectedUser: text.includes('KEEP_SELECTED_USER'),
        hasDroppedOld: text.includes('OLD_DROPPED_CONTEXT_MESSAGE'),
        hasSecretToken: text.includes('context-debug-secret') || text.includes('DEEPSEEK_API_KEY'),
        hasToolDefinition: text.includes('getWeather'),
        hasStandardLabels:
          Boolean(modal?.querySelector('section[aria-label="Context Statistics"]')) &&
          [
            'Model Context', 'Model Parameters', 'Provider', 'Model', 'Streaming',
            'Tool Choice', 'Reasoning', 'API Key', 'Storage', 'Temperature', 'Max Tokens',
            'Messages', 'Tool Definitions'
          ].every((label) => text.includes(label)),
        hasStandardValues: [
          'DeepSeek', 'Enabled', 'Auto', 'Max', 'Configured', 'File', 'Provider Default'
        ].every((value) => text.includes(value)),
        requestCount: state.contextPreviewRequests.length,
        requestQuestion: state.contextPreviewRequests.at(-1)?.question,
        storedMessageCount: state.conversations[0]?.messages.length,
        noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        modalFitsViewport: modal ? modal.getBoundingClientRect().width <= window.innerWidth : false
      };
    })()`
  )
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const { chrome } = await launchChrome({
    url: 'about:blank',
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-context-debug-',
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
    await waitForEval(client, `document.readyState === 'complete' && Boolean(document.querySelector('textarea'))`)

    await typeQuestion(client, 'CURRENT_DEBUG_QUESTION')
    await clickAppAction(client, '上下文')
    await waitForEval(client, `Boolean(document.querySelector('.context-debug-modal'))`)
    screenshots.push(await screenshot(client, OUT_DIR, '01-context-debug-modal', CAPTURE_SCREENSHOTS))

    const desktopState = await readModalState(client)
    assert(desktopState.hasModal, 'context debug modal did not open')
    assert(desktopState.hasQuestion, 'current draft question was not included in context preview')
    assert(desktopState.hasSelectedAssistant, 'selected assistant history was not displayed')
    assert(desktopState.hasSelectedUser, 'selected user history was not displayed')
    assert(!desktopState.hasDroppedOld, 'dropped old history leaked into context preview')
    assert(!desktopState.hasSecretToken, 'secret token leaked into context preview')
    assert(desktopState.hasToolDefinition, 'tool definition summary was not displayed')
    assert(desktopState.hasStandardLabels, 'context debug labels exposed raw internal names')
    assert(desktopState.hasStandardValues, 'context debug values exposed raw internal values')
    assert(desktopState.requestCount === 1, 'context preview endpoint should be called once')
    assert(desktopState.requestQuestion === 'CURRENT_DEBUG_QUESTION', 'preview endpoint did not receive current draft question')
    assert(desktopState.storedMessageCount === 3, 'context preview should not mutate stored conversation messages')

    await clickButtonByText(client, 'Close')
    await waitForEval(client, `!document.querySelector('.context-debug-modal')`)
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 820,
      deviceScaleFactor: 1,
      mobile: true
    })
    await clickAppAction(client, '上下文')
    await waitForEval(client, `Boolean(document.querySelector('.context-debug-modal'))`)
    screenshots.push(await screenshot(client, OUT_DIR, '02-context-debug-mobile', CAPTURE_SCREENSHOTS))

    const mobileState = await readModalState(client)
    assert(mobileState.noPageOverflow, 'mobile context debug view caused page-level horizontal overflow')
    assert(mobileState.modalFitsViewport, 'mobile context debug modal does not fit viewport')

    const summary = {
      allPassed: true,
      screenshots: screenshots.filter(Boolean),
      assertions: {
        desktop: desktopState,
        mobile: mobileState
      }
    }
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    client?.close()
    await stopProcess(chrome)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
