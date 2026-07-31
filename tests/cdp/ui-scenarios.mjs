import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const APP_ORIGIN = new URL(APP_URL).origin
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9333)
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-screenshots')
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const CDP_COMMAND_TIMEOUT_MS = 10000

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.events = new Map()

    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })

    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data)

      if (payload.id) {
        const request = this.pending.get(payload.id)
        if (!request) return
        this.pending.delete(payload.id)

        if (payload.error) {
          request.reject(new Error(`${payload.error.message}: ${payload.error.data || ''}`))
        } else {
          request.resolve(payload.result || {})
        }

        return
      }

      const listeners = this.events.get(payload.method)
      if (listeners) {
        for (const listener of listeners) {
          listener(payload.params || {})
        }
      }
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const context =
          method === 'Runtime.evaluate' && params.expression
            ? `: ${params.expression.slice(0, 180)}`
            : ''
        reject(new Error(`CDP command timed out: ${method}${context}`))
      }, CDP_COMMAND_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
    })
  }

  on(method, callback) {
    const listeners = this.events.get(method) || []
    listeners.push(callback)
    this.events.set(method, listeners)
  }

  close() {
    this.ws.close()
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // keep polling
    }

    await delay(200)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function waitFor(client, expression, timeoutMs = 6000) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const result = await evaluate(client, expression)
    if (result) return result
    await delay(80)
  }

  throw new Error(`Timed out waiting for expression: ${expression}`)
}

async function waitForEvent(client, method, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Timed out waiting for CDP event: ${method}`))
    }, timeoutMs)

    client.on(method, (params) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(params)
    })
  })
}

async function navigateAndWait(client, url) {
  const loaded = waitForEvent(client, 'Page.loadEventFired')
  await client.send('Page.navigate', { url })
  await loaded
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })

  if (result.exceptionDetails) {
    const detail =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.exception?.value ||
      result.exceptionDetails.text ||
      'Runtime evaluation failed'
    throw new Error(detail)
  }

  return result.result?.value
}

async function screenshot(client, name) {
  if (!CAPTURE_SCREENSHOTS) return null
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })
  const filePath = path.join(OUT_DIR, `${name}.png`)
  await writeFile(filePath, Buffer.from(result.data, 'base64'))
  console.log(filePath)
}

async function resetPage(client) {
  await navigateAndWait(client, 'about:blank')
  await waitFor(client, 'document.readyState === "complete"')
  await navigateAndWait(client, APP_URL)
  await waitFor(
    client,
    `location.href.startsWith(${JSON.stringify(APP_URL)}) && document.querySelector("textarea")`,
  )

  const isEmpty = await evaluate(client, 'Boolean(document.querySelector(".empty-state"))')
  if (!isEmpty) {
    await clickText(client, 'button', '新建')
    await waitFor(client, 'document.querySelector("textarea") && document.querySelector(".empty-state")')
  }
}

async function setPlan(client, plans) {
  await evaluate(client, `window.__setAskPlans(${JSON.stringify(plans)})`)
}

async function waitIdle(client) {
  await waitFor(
    client,
    `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送') &&
      ![...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`,
  )
}

async function ask(client, question) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('textarea');
      input.value = ${JSON.stringify(question)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`,
  )
}

async function clickText(client, selector, text) {
  await evaluate(
    client,
    `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((node) => node.textContent.trim() === ${JSON.stringify(text)});
      if (!el) throw new Error('Cannot find clickable text: ${text}');
      el.click();
    })()`,
  )
}

async function clickDialogButton(client, text) {
  await evaluate(
    client,
    `(() => {
      const dialog = document.querySelector('.modal-content[role="dialog"]');
      if (!dialog) throw new Error('Cannot find app dialog');
      const button = [...dialog.querySelectorAll('button')]
        .find((node) => node.textContent.trim() === ${JSON.stringify(text)});
      if (!button) throw new Error('Cannot find dialog button: ${text}');
      button.click();
    })()`,
  )
}

async function waitForDialog(client, title) {
  await waitFor(
    client,
    `document.querySelector('.modal-content[role="dialog"]')?.innerText.includes(${JSON.stringify(title)})`,
  )
}

async function cancelDialog(client) {
  await clickDialogButton(client, '取消')
  await waitFor(client, `!document.querySelector('.modal-content[role="dialog"]')`)
}

async function confirmDialog(client, label = '确定') {
  await clickDialogButton(client, label)
  await waitFor(client, `!document.querySelector('.modal-content[role="dialog"]')`)
}

async function submitPromptDialog(client, value, options = {}) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('.modal-content[role="dialog"] .dialog-input');
      if (!input) throw new Error('Cannot find dialog input');
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  )
  await clickDialogButton(client, '保存')

  if (options.waitForClose !== false) {
    await waitFor(client, `!document.querySelector('.modal-content[role="dialog"]')`)
  }
}

async function ensureClipboard(client) {
  await client.send('Page.bringToFront').catch(() => {})
  await client.send('Browser.grantPermissions', {
    origin: APP_ORIGIN,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  }).catch(() => {})
}

async function clickConversationAt(client, index) {
  await evaluate(
    client,
    `(() => {
      const item = [...document.querySelectorAll('.conversation-item')][${index}];
      if (!item) throw new Error('Cannot find conversation at index ${index}');
      item.click();
    })()`,
  )
}

async function clickConversationActionAt(client, index, title) {
  const rect = await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')][${index}];
      if (!shell) throw new Error('Cannot find conversation shell at index ${index}');
      const button = [...shell.querySelectorAll('.conversation-action-btn')]
        .find((node) => node.getAttribute('title') === ${JSON.stringify(title)} || node.textContent.trim() === ${JSON.stringify(title)});
      if (!button) throw new Error('Cannot find conversation action ${title} at index ${index}');
      shell.scrollIntoView({ block: 'center', inline: 'nearest' });
      shell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
      button.focus();
      const rect = button.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })()`,
  )
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: rect.x,
    y: rect.y,
  })
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  })
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  })
}

async function invokeConversationActionAt(client, index, title) {
  await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')][${index}];
      if (!shell) throw new Error('Cannot find conversation shell at index ${index}');
      const button = [...shell.querySelectorAll('.conversation-action-btn')]
        .find((node) => node.getAttribute('title') === ${JSON.stringify(title)} || node.textContent.trim() === ${JSON.stringify(title)});
      if (!button) throw new Error('Cannot find conversation action ${title} at index ${index}');
      button.click();
    })()`,
  )
}

async function clickFirstSuggestion(client) {
  await evaluate(
    client,
    `(() => {
      const item = document.querySelector('.suggestion-card');
      if (!item) throw new Error('Cannot find suggestion card');
      item.click();
    })()`,
  )
}

async function seedConversations(client, conversations) {
  await evaluate(client, `window.__resetMockData(${JSON.stringify(conversations)})`)
}

async function setMockFlags(client, flags) {
  await evaluate(client, `window.__setMockFlags(${JSON.stringify(flags)})`)
}

async function typeText(client, text) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('textarea');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  )
}

function makeLongChunks(prefix, count) {
  return Array.from(
    { length: count },
    (_, index) => `${prefix} ${index + 1}. 这是一段用于拉长聊天内容的文本。\n`,
  )
}

const mockScript = `
(() => {
  const originalFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  let plans = [];
  let conversationSeq = 0;
  const requests = [];
  const conversations = new Map();
  const STORAGE_KEY = '__cdpMockConversations';
  const flags = {
    failNextCreate: false,
    failNextDetail: false,
    failNextRename: false,
    failNextDelete: false,
    failNextClear: false,
    cancelDelayMs: 0,
  };
  window.__abortCount = 0;
  window.__askCount = 0;

  window.__setAskPlans = (nextPlans) => {
    plans = nextPlans.slice();
    window.__abortCount = 0;
    window.__askCount = 0;
  };

  window.__setMockFlags = (nextFlags) => {
    Object.assign(flags, nextFlags || {});
  };

  function serializeConversations() {
    return [...conversations.values()].map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message })),
    }));
  }

  function persistMockData() {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializeConversations()));
  }

  function applyMockData(items = []) {
    conversations.clear();
    conversationSeq = 0;
    for (const item of items) {
      const numericId = String(item.id || '').match(/^ui-cdp-(\\d+)$/);
      conversationSeq = Math.max(
        conversationSeq + 1,
        numericId ? Number(numericId[1]) : 0,
      );
      const timestamp = item.updatedAt || item.createdAt || now();
      const conversation = {
        id: item.id || 'ui-cdp-' + conversationSeq,
        title: item.title || '新的聊天',
        createdAt: item.createdAt || timestamp,
        updatedAt: timestamp,
        messages: Array.isArray(item.messages) ? item.messages.map((message) => ({ ...message })) : [],
      };
      conversations.set(conversation.id, conversation);
    }
  }

  window.__resetMockData = (items = []) => {
    applyMockData(items);
    persistMockData();
  };

  window.__mockSnapshot = () => ({
    conversations: serializeConversations(),
    requests: requests.slice(),
    askCount: window.__askCount,
    abortCount: window.__abortCount,
  });

  function consumeFlag(name) {
    const value = Boolean(flags[name]);
    flags[name] = false;
    return value;
  }

  const seededConversations = sessionStorage.getItem(STORAGE_KEY);
  if (seededConversations) {
    applyMockData(JSON.parse(seededConversations));
  }

  function line(event) {
    return encoder.encode(JSON.stringify(event) + '\\n');
  }

  function now() {
    return new Date().toISOString();
  }

  function summary(conversation) {
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
    };
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function streamHeaders(plan) {
    const headers = { 'Content-Type': 'application/x-ndjson; charset=utf-8' };

    if (!plan.omitProtocolHeader) {
      headers['X-Chat-Stream-Protocol'] = plan.protocolVersion || '2';
    }

    return headers;
  }

  function createConversation(title = '新的聊天') {
    conversationSeq += 1;
    const timestamp = now();
    const conversation = {
      id: 'ui-cdp-' + conversationSeq,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    conversations.set(conversation.id, conversation);
    persistMockData();
    return conversation;
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const parsed = new URL(url, window.location.origin);
    const pathname = parsed.pathname.replace(/^\\/api/, '');
    const method = (init.method || 'GET').toUpperCase();
    requests.push({ method, pathname });

    if (pathname === '/runtime-config' && method === 'GET') {
      return json({
        runtime: {
          provider: 'deepseek',
          model: 'mock-chat-model',
          storageBackend: 'file',
          endpointConfigured: true,
          apiKeyConfigured: true,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            reasoningEnabled: true,
            reasoningEffort: 'medium',
          },
        },
      });
    }

    if (pathname === '/conversations' && method === 'GET') {
      return json({
        conversations: [...conversations.values()]
          .map(summary)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      });
    }

    if (pathname === '/conversations' && method === 'POST') {
      if (consumeFlag('failNextCreate')) {
        return json({ message: 'create failed' }, 500);
      }
      const body = JSON.parse(init.body || '{}');
      const conversation = createConversation(body.title || '新的聊天');
      return json({ conversation }, 201);
    }

    const detailMatch = pathname.match(/^\\/conversations\\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      if (consumeFlag('failNextDetail')) {
        return json({ message: 'detail failed' }, 500);
      }
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      return conversation ? json({ conversation }) : json({ message: 'not found' }, 404);
    }

    if (detailMatch && method === 'PATCH') {
      if (consumeFlag('failNextRename')) {
        return json({ message: 'rename failed' }, 500);
      }
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      const body = JSON.parse(init.body || '{}');
      conversation.title = body.title || conversation.title;
      conversation.updatedAt = now();
      persistMockData();
      return json({ conversation });
    }

    if (detailMatch && method === 'DELETE') {
      if (consumeFlag('failNextDelete')) {
        return json({ message: 'delete failed' }, 500);
      }
      const id = decodeURIComponent(detailMatch[1]);
      if (!conversations.has(id)) return json({ message: 'not found' }, 404);
      conversations.delete(id);
      persistMockData();
      return new Response(null, { status: 204 });
    }

    const clearMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/clear$/);
    if (clearMatch && method === 'POST') {
      if (consumeFlag('failNextClear')) {
        return json({ message: 'clear failed' }, 500);
      }
      const conversation = conversations.get(decodeURIComponent(clearMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      conversation.messages = [];
      conversation.updatedAt = now();
      persistMockData();
      return json({ conversation });
    }

    const askMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/ask$/);

    if (pathname.startsWith('/requests/') && pathname.endsWith('/cancel') && method === 'POST') {
      if (flags.cancelDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, flags.cancelDelayMs));
      }
      return json({ cancelled: true });
    }

    if (url.includes('/api/history')) {
      return new Response(JSON.stringify({ conversations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/clear')) {
      return new Response(JSON.stringify({ message: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!askMatch) {
      return originalFetch(input, init);
    }

    const conversation = conversations.get(decodeURIComponent(askMatch[1]));
    if (!conversation) {
      return json({ message: 'not found' }, 404);
    }

    window.__askCount += 1;
    const body = JSON.parse(init.body || '{}');
    const question = body.question || '';
    const plan = plans.shift() || { kind: 'success', chunks: ['默认回复'], interval: 40 };

    if (plan.kind === 'httpError') {
      return new Response('failed', { status: plan.status || 500 });
    }

    if (plan.kind === 'networkError') {
      throw new TypeError(plan.message || 'Failed to fetch');
    }

    const stream = new ReadableStream({
      start(controller) {
        let index = 0;
        let reasoningIndex = 0;
        let answer = '';
        let reasoning = '';
        let timer;
        let closed = false;

        const closeWithAbort = () => {
          if (closed) return;
          closed = true;
          window.__abortCount += 1;
          window.clearTimeout(timer);
          controller.error(new DOMException('Aborted', 'AbortError'));
        };

        if (init.signal?.aborted) {
          closeWithAbort();
          return;
        }

        init.signal?.addEventListener('abort', closeWithAbort, { once: true });

        const push = () => {
          if (closed) return;

          if (plan.kind === 'streamError') {
            controller.enqueue(line({ type: 'error', message: plan.message || '模拟失败' }));
            closed = true;
            controller.close();
            return;
          }

          if (plan.kind === 'malformedNdjson') {
            controller.enqueue(encoder.encode('{bad json\\n'));
            closed = true;
            controller.close();
            return;
          }

          if (plan.kind === 'invalidReasoningEvent') {
            controller.enqueue(line({ type: 'reasoning_delta', content: 123 }));
            closed = true;
            controller.close();
            return;
          }

          if (plan.kind === 'invalidDoneEvent') {
            controller.enqueue(line({ type: 'done', reasoningDurationMs: 'bad' }));
            closed = true;
            controller.close();
            return;
          }

          if (reasoningIndex < (plan.reasoningChunks || []).length) {
            const chunk = plan.reasoningChunks[reasoningIndex];
            reasoning += chunk;
            controller.enqueue(line({ type: 'reasoning_delta', content: chunk }));
            reasoningIndex += 1;
            timer = window.setTimeout(push, plan.reasoningInterval ?? plan.interval ?? 80);
            return;
          }

          if (index < (plan.chunks || []).length) {
            const chunk = plan.chunks[index];
            answer += chunk;
            controller.enqueue(line({ type: 'delta', content: chunk }));
            index += 1;
            timer = window.setTimeout(push, plan.interval ?? 80);
            return;
          }

          if (plan.kind === 'abruptClose') {
            closed = true;
            controller.error(new TypeError(plan.message || 'network lost'));
            return;
          }

          if (plan.done === false) {
            timer = window.setTimeout(push, plan.interval ?? 80);
            return;
          }

          if (plan.kind === 'noDoneClose') {
            closed = true;
            controller.close();
            return;
          }

          if (plan.kind === 'extraAfterDone') {
            controller.enqueue(line({ type: 'done' }));
            controller.enqueue(line({ type: 'delta', content: plan.extraContent || '不应该显示的内容' }));
            conversation.messages.push(
              { role: 'user', content: question },
              { role: 'assistant', content: answer },
            );
            conversation.updatedAt = now();
            persistMockData();
            closed = true;
            controller.close();
            return;
          }

          controller.enqueue(line({
            type: 'done',
            reasoningDurationMs: typeof plan.reasoningDurationMs === 'number'
              ? plan.reasoningDurationMs
              : reasoning
                ? 123
                : undefined,
          }));
          conversation.messages.push(
            { role: 'user', content: question },
            {
              role: 'assistant',
              content: answer,
              reasoningContent: reasoning || undefined,
              reasoningDurationMs: reasoning ? 123 : undefined,
            },
          );
          conversation.updatedAt = now();
          persistMockData();
          closed = true;
          controller.close();
        };

        timer = window.setTimeout(push, plan.firstDelay ?? 80);
      },
      cancel() {
        window.__abortCount += 1;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: streamHeaders(plan),
    });
  };
})();
`

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const profileDir = await mkdtemp(path.join(tmpdir(), 'chatbot-cdp-'))
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars=false',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1280,900',
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  chrome.stderr.on('data', () => {})

  try {
    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`)

    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
    const target =
      targets.find((item) => item.type === 'page' && item.url === 'about:blank') ||
      targets.find((item) => item.type === 'page')
    const client = new CdpClient(target.webSocketDebuggerUrl)

    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Browser.grantPermissions', {
      origin: APP_ORIGIN,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    }).catch(() => {})
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript })
    await client.send('Page.navigate', { url: APP_URL })

    await resetPage(client)

    console.log('UI stage: initialization, sidebar, dialogs, and API failures')
    const initialState = await evaluate(
      client,
      `(() => ({
        hasSidebar: Boolean(document.querySelector('.sidebar')),
        hasEmptyState: Boolean(document.querySelector('.empty-state')),
        suggestionCount: document.querySelectorAll('.suggestion-card').length,
        activeCount: document.querySelectorAll('.conversation-item-shell.active').length,
        sendDisabled: [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '发送')?.disabled === true,
        textareaDisabled: document.querySelector('textarea')?.disabled === false,
        pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
      }))()`,
    )
    if (
      !initialState.hasSidebar ||
      !initialState.hasEmptyState ||
      initialState.suggestionCount !== 4 ||
      initialState.activeCount !== 1 ||
      !initialState.sendDisabled ||
      !initialState.textareaDisabled ||
      initialState.pageOverflowX
    ) {
      throw new Error(`Initial UI state failed: ${JSON.stringify(initialState)}`)
    }

    const oldDataMessages = [
      { role: 'user', content: '旧格式用户消息' },
      { role: 'assistant', content: '旧格式助手消息，没有 reasoning 字段' },
    ]
    const manyConversations = Array.from({ length: 48 }, (_, index) => ({
      id: `ui-seed-${index + 1}`,
      title:
        index === 0
          ? '这是一个非常非常非常非常非常非常长的会话标题用于测试侧栏省略和按钮布局'
          : `侧栏会话 ${index + 1}`,
      createdAt: new Date(Date.now() - index * 1000).toISOString(),
      updatedAt: new Date(Date.now() - index * 1000).toISOString(),
      messages: index === 0
        ? oldDataMessages
        : [
            { role: 'user', content: `会话 ${index + 1} 用户消息` },
            { role: 'assistant', content: `会话 ${index + 1} 助手消息` },
          ],
    }))
    await seedConversations(client, manyConversations)
    await client.send('Page.reload')
    await waitFor(client, `document.body.innerText.includes('旧格式助手消息，没有 reasoning 字段')`)
    const sidebarState = await evaluate(
      client,
      `(() => {
        const panel = document.querySelector('.conversation-panel');
        const title = document.querySelector('.conversation-title');
        const activeShell = document.querySelector('.conversation-item-shell.active');
        const actionRects = [...activeShell.querySelectorAll('.conversation-action-btn')]
          .map((button) => button.getBoundingClientRect());
        const actionLabels = [...activeShell.querySelectorAll('.conversation-action-btn')]
          .map((button) => button.textContent.trim());
        return {
          count: document.querySelectorAll('.conversation-item-shell').length,
          panelScrollable: panel.scrollHeight > panel.clientHeight,
          activeCount: document.querySelectorAll('.conversation-item-shell.active').length,
          longTitleConstrained: title.scrollWidth >= title.clientWidth,
          actionLabels,
          actionsVisible: actionRects.length === 3 && actionRects.every((rect) => rect.width > 0 && rect.height > 0),
          hasReasoningPanelForOldData: Boolean(document.querySelector('.reasoning-panel')),
          pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
        };
      })()`,
    )
    if (
      sidebarState.count !== manyConversations.length ||
      !sidebarState.panelScrollable ||
      sidebarState.activeCount !== 1 ||
      !sidebarState.longTitleConstrained ||
      JSON.stringify(sidebarState.actionLabels) !== JSON.stringify(['导出', '重命名', '删除']) ||
      !sidebarState.actionsVisible ||
      sidebarState.hasReasoningPanelForOldData ||
      sidebarState.pageOverflowX
    ) {
      throw new Error(`Sidebar boundary assertions failed: ${JSON.stringify(sidebarState)}`)
    }

    const titleBeforeRename = await evaluate(
      client,
      `document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim()`,
    )
    await clickConversationActionAt(client, 0, '重命名')
    await waitForDialog(client, '重命名会话')
    await cancelDialog(client)
    await clickConversationActionAt(client, 0, '重命名')
    await waitForDialog(client, '重命名会话')
    await submitPromptDialog(client, '   ')
    await setMockFlags(client, { failNextRename: true })
    await clickConversationActionAt(client, 0, '重命名')
    await waitForDialog(client, '重命名会话')
    await submitPromptDialog(client, '失败的新标题', { waitForClose: false })
    await waitForDialog(client, '操作失败')
    await confirmDialog(client, '知道了')
    await delay(500)
    const renameState = await evaluate(
      client,
      `(() => ({
        title: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
        count: document.querySelectorAll('.conversation-item-shell').length,
      }))()`,
    )
    if (renameState.title !== titleBeforeRename || renameState.count !== manyConversations.length) {
      throw new Error(`Rename cancel/blank/failure assertions failed: ${JSON.stringify(renameState)}`)
    }

    await waitFor(client, `document.querySelector('.clear-history-btn')?.disabled === false`)
    await clickConversationActionAt(client, 0, '删除')
    await waitForDialog(client, '删除会话')
    await cancelDialog(client)
    const deleteCancelCount = await evaluate(client, `document.querySelectorAll('.conversation-item-shell').length`)
    if (deleteCancelCount !== manyConversations.length) {
      throw new Error(`Delete cancel removed a conversation: ${deleteCancelCount}`)
    }

    await clickConversationActionAt(client, 1, '删除')
    await waitForDialog(client, '删除会话')
    await confirmDialog(client, '删除')
    await delay(100)
    const afterMouseDeleteState = await evaluate(
      client,
      `(() => ({
        domCount: document.querySelectorAll('.conversation-item-shell').length,
        mockCount: window.__mockSnapshot().conversations.length,
      }))()`,
    )
    if (
      afterMouseDeleteState.domCount === manyConversations.length &&
      afterMouseDeleteState.mockCount === manyConversations.length
    ) {
      await invokeConversationActionAt(client, 1, '删除')
      await waitForDialog(client, '删除会话')
      await confirmDialog(client, '删除')
    }
    try {
      await waitFor(client, `document.querySelectorAll('.conversation-item-shell').length === ${manyConversations.length - 1}`)
    } catch (err) {
      const deleteDebugState = await evaluate(
        client,
        `(() => ({
          domCount: document.querySelectorAll('.conversation-item-shell').length,
          activeTitle: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
          clearDisabled: document.querySelector('.clear-history-btn')?.disabled,
          snapshot: window.__mockSnapshot(),
        }))()`,
      )
      throw new Error(`Delete non-current did not update list: ${JSON.stringify(deleteDebugState)}`)
    }
    const deleteNonCurrentState = await evaluate(
      client,
      `(() => ({
        count: document.querySelectorAll('.conversation-item-shell').length,
        activeText: document.querySelector('.message-list')?.innerText || '',
        activeTitle: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
      }))()`,
    )
    if (
      deleteNonCurrentState.count !== manyConversations.length - 1 ||
      !deleteNonCurrentState.activeText.includes('旧格式助手消息') ||
      deleteNonCurrentState.activeTitle !== titleBeforeRename
    ) {
      throw new Error(`Delete non-current conversation failed: ${JSON.stringify(deleteNonCurrentState)}`)
    }

    await typeText(client, '清空取消前草稿')
    await clickText(client, 'button', '清空当前会话')
    await waitForDialog(client, '清空当前会话')
    await cancelDialog(client)
    const clearCancelState = await evaluate(
      client,
      `(() => ({
        value: document.querySelector('textarea')?.value,
        text: document.querySelector('.message-list')?.innerText || '',
      }))()`,
    )
    if (clearCancelState.value !== '清空取消前草稿' || !clearCancelState.text.includes('旧格式助手消息')) {
      throw new Error(`Clear cancel failed: ${JSON.stringify(clearCancelState)}`)
    }

    await setMockFlags(client, { failNextCreate: true })
    await clickText(client, 'button', '新建')
    await waitForDialog(client, '操作失败')
    await confirmDialog(client, '知道了')
    const newChatFailureState = await evaluate(
      client,
      `(() => ({
        text: document.querySelector('.message-list')?.innerText || '',
        activeTitle: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
      }))()`,
    )
    if (!newChatFailureState.text.includes('旧格式助手消息') || newChatFailureState.activeTitle !== titleBeforeRename) {
      throw new Error(`New chat failure changed current state: ${JSON.stringify(newChatFailureState)}`)
    }

    await setMockFlags(client, { failNextDetail: true })
    await clickConversationAt(client, 1)
    await waitForDialog(client, '操作失败')
    await confirmDialog(client, '知道了')
    const switchFailureState = await evaluate(
      client,
      `(() => ({
        text: document.querySelector('.message-list')?.innerText || '',
        activeTitle: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
      }))()`,
    )
    if (!switchFailureState.text.includes('旧格式助手消息') || switchFailureState.activeTitle !== titleBeforeRename) {
      throw new Error(`Switch failure changed current state: ${JSON.stringify(switchFailureState)}`)
    }

    await seedConversations(client, [{
      id: 'ui-only-one',
      title: '唯一会话',
      messages: [
        { role: 'user', content: '唯一会话用户消息' },
        { role: 'assistant', content: '唯一会话助手消息' },
      ],
    }])
    await client.send('Page.reload')
    await waitFor(client, `document.body.innerText.includes('唯一会话助手消息')`)
    await clickConversationActionAt(client, 0, '删除')
    await waitForDialog(client, '删除会话')
    await confirmDialog(client, '删除')
    await waitFor(
      client,
      `document.querySelector('.empty-state') &&
        document.querySelectorAll('.conversation-item-shell').length === 1 &&
        document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.includes('0 条消息')`,
    )
    const deleteLastState = await evaluate(
      client,
      `(() => ({
        isEmpty: Boolean(document.querySelector('.empty-state')),
        count: document.querySelectorAll('.conversation-item-shell').length,
        canFocusComposer: document.activeElement === document.querySelector('textarea'),
      }))()`,
    )
    if (!deleteLastState.isEmpty || deleteLastState.count !== 1 || !deleteLastState.canFocusComposer) {
      throw new Error(`Delete last conversation failed: ${JSON.stringify(deleteLastState)}`)
    }

    await resetPage(client)

    console.log('UI stage: reasoning panel and stream protocol')
    await setPlan(client, [{
      kind: 'success',
      reasoningChunks: ['先分析问题。', '再给出结论。'],
      chunks: ['最终回答。'],
      reasoningInterval: 20,
      interval: 20,
      reasoningDurationMs: 88,
    }])
    await ask(client, '测试 reasoning 面板')
    await waitFor(client, `document.body.innerText.includes('最终回答。')`)
    await waitIdle(client)
    const reasoningState = await evaluate(
      client,
      `(() => {
        const panel = document.querySelector('.reasoning-panel');
        const summary = document.querySelector('.reasoning-summary');
        const body = document.querySelector('.reasoning-content-body');
        const assistant = [...document.querySelectorAll('.message-row.assistant')].at(-1);
        return {
          hasPanel: Boolean(panel),
          open: panel?.hasAttribute('open') ?? null,
          summary: summary?.textContent.trim(),
          reasoningText: body?.textContent.trim(),
          answerText: assistant?.innerText || '',
        };
      })()`,
    )
    if (
      !reasoningState.hasPanel ||
      reasoningState.open !== false ||
      reasoningState.summary !== 'Thoughts' ||
      !reasoningState.reasoningText.includes('先分析问题。再给出结论。') ||
      !reasoningState.answerText.includes('最终回答。')
    ) {
      throw new Error(`Reasoning panel assertions failed: ${JSON.stringify(reasoningState)}`)
    }
    await ensureClipboard(client)
    await clickText(client, 'button', '复制')
    await waitFor(client, `document.body.innerText.includes('已复制')`)
    const reasoningCopyText = await evaluate(client, `navigator.clipboard.readText()`)
    if (reasoningCopyText.includes('先分析问题') || reasoningCopyText !== '最终回答。') {
      throw new Error(`Reasoning copy leaked non-answer text: ${JSON.stringify(reasoningCopyText)}`)
    }
    await evaluate(client, `document.querySelector('.reasoning-summary')?.click()`)
    const reasoningExpanded = await evaluate(client, `document.querySelector('.reasoning-panel')?.hasAttribute('open')`)
    await evaluate(client, `document.querySelector('.reasoning-summary')?.click()`)
    const reasoningCollapsed = await evaluate(client, `document.querySelector('.reasoning-panel')?.hasAttribute('open')`)
    if (reasoningExpanded !== true || reasoningCollapsed !== false) {
      throw new Error(`Reasoning expand/collapse failed: ${JSON.stringify({ reasoningExpanded, reasoningCollapsed })}`)
    }
    await typeText(client, '切换前 reasoning 草稿')
    await clickText(client, 'button', '新建')
    await waitFor(client, `document.querySelector('.empty-state') && document.querySelector('textarea')?.value === ''`)
    await clickConversationAt(client, 1)
    const reasoningAfterSwitch = await waitFor(
      client,
      `(() => {
        const panel = document.querySelector('.reasoning-panel');
        return panel &&
          document.querySelector('.reasoning-content-body')?.textContent.includes('先分析问题。再给出结论。') &&
          document.body.innerText.includes('最终回答。');
      })()`,
    )
    if (!reasoningAfterSwitch) {
      throw new Error('Reasoning panel was not restored after conversation switch')
    }

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      reasoningChunks: ['## reasoning 不应作为 Markdown 渲染'],
      chunks: ['**Markdown 正文加粗**\n\n```ts\nconst ok = true\n```'],
      interval: 20,
    }])
    await ask(client, 'reasoning + markdown')
    await waitFor(
      client,
      `document.querySelector('.reasoning-content-body')?.textContent.includes('## reasoning 不应作为 Markdown 渲染') &&
        document.querySelector('.message-row.assistant strong')?.textContent.includes('Markdown 正文加粗') &&
        document.querySelector('.message-row.assistant pre code')?.textContent.includes('const ok')`,
    )
    await waitIdle(client)
    const reasoningMarkdownState = await evaluate(
      client,
      `(() => ({
        reasoningRenderedAsHeading: Boolean(document.querySelector('.reasoning-content-body h2')),
        hasStrong: Boolean(document.querySelector('.message-row.assistant strong')),
        hasCode: Boolean(document.querySelector('.message-row.assistant pre code')),
      }))()`,
    )
    if (
      reasoningMarkdownState.reasoningRenderedAsHeading ||
      !reasoningMarkdownState.hasStrong ||
      !reasoningMarkdownState.hasCode
    ) {
      throw new Error(`Reasoning + Markdown assertions failed: ${JSON.stringify(reasoningMarkdownState)}`)
    }

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      reasoningChunks: ['这段 reasoning 会被停止。'],
      chunks: ['不应该完整输出。'],
      reasoningInterval: 300,
      interval: 300,
      done: false,
    }])
    await ask(client, 'reasoning 阶段停止')
    await waitFor(client, `document.body.innerText.includes('这段 reasoning 会被停止。')`)
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    await waitIdle(client)
    const reasoningAbortCount = await waitFor(client, `window.__abortCount > 0 && window.__abortCount`)

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      reasoningChunks: ['只有 reasoning，没有正文。'],
      chunks: [],
      interval: 20,
    }])
    await ask(client, 'reasoning only error')
    await waitFor(client, `document.body.innerText.includes('模型未返回内容')`)
    await waitIdle(client)

    await resetPage(client)
    await setPlan(client, [
      { kind: 'success', chunks: ['缺少协议 header。'], omitProtocolHeader: true, interval: 20 },
      { kind: 'success', chunks: ['协议错误后恢复成功。'], interval: 20 },
      { kind: 'invalidReasoningEvent' },
      { kind: 'invalidDoneEvent' },
    ])
    await ask(client, '缺少协议 header')
    await waitFor(client, `document.body.innerText.includes('不支持的流式协议版本')`)
    await waitIdle(client)
    await ask(client, '协议错误后恢复')
    await waitFor(client, `document.body.innerText.includes('协议错误后恢复成功。')`)
    await waitIdle(client)
    await ask(client, '非法 reasoning event')
    await waitFor(client, `document.body.innerText.includes('服务端返回了无效的流式内容')`)
    await waitIdle(client)
    await ask(client, '非法 done event')
    await waitFor(client, `document.body.innerText.includes('服务端返回了无效的完成事件')`)
    await waitIdle(client)

    await resetPage(client)

    console.log('UI stage: stop/copy/recovery')
    await setPlan(client, [{
      kind: 'success',
      chunks: ['正在生成第一段。', '正在生成第二段。', '这段会保持生成状态。'],
      interval: 350,
      done: false,
    }])
    await ask(client, '测试停止按钮')
    await waitFor(client, `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`)
    await waitFor(client, `document.body.innerText.includes('正在生成第一段。')`)
    const streamingActionState = await evaluate(
      client,
      `(() => ({
        hasCopy: [...document.querySelectorAll('.message-row.assistant .message-action-btn')]
          .some((button) => button.textContent.trim() === '复制'),
        hasRetry: [...document.querySelectorAll('.message-row.assistant .message-action-btn')]
          .some((button) => button.textContent.trim() === '重试'),
        textareaDisabled: document.querySelector('textarea')?.disabled === true,
      }))()`,
    )
    if (streamingActionState.hasCopy || streamingActionState.hasRetry || !streamingActionState.textareaDisabled) {
      throw new Error(`Streaming action visibility failed: ${JSON.stringify(streamingActionState)}`)
    }
    await screenshot(client, '01-generating-stop-button')
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成') && [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送')`)
    await screenshot(client, '01-stopped-after-click')
    await ensureClipboard(client)
    await clickText(client, 'button', '复制')
    await waitFor(client, `document.body.innerText.includes('已复制')`)
    const stoppedActionState = await evaluate(
      client,
      `(() => ({
        hasCopied: document.body.innerText.includes('已复制'),
        hasRetry: [...document.querySelectorAll('.message-row.assistant .message-action-btn')]
          .some((button) => button.textContent.trim() === '重试'),
      }))()`,
    )
    if (!stoppedActionState.hasCopied || stoppedActionState.hasRetry) {
      throw new Error(`Stopped action visibility failed: ${JSON.stringify(stoppedActionState)}`)
    }
    await screenshot(client, '01-stopped-copy')

    await setPlan(client, [{
      kind: 'success',
      chunks: ['停止后新的请求成功。'],
      interval: 40,
    }])
    await ask(client, '停止后继续发送')
    await waitFor(client, `document.body.innerText.includes('停止后新的请求成功。')`)
    await waitIdle(client)
    await screenshot(client, '01-continue-after-stop')

    console.log('UI stage: retry and scroll')
    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      chunks: ['重复停止第一段。', '重复停止第二段。'],
      interval: 350,
      done: false,
    }])
    await ask(client, '测试重复停止')
    await waitFor(client, `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`)
    await setMockFlags(client, { cancelDelayMs: 180 })
    const cancelCountBefore = await evaluate(
      client,
      `window.__mockSnapshot().requests.filter((request) => request.pathname.endsWith('/cancel')).length`,
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((node) => node.textContent.trim() === '停止');
        button?.click();
        button?.click();
        button?.click();
      })()`,
    )
    await waitFor(
      client,
      `[...document.querySelectorAll('button')]
        .some((button) =>
          button.textContent.trim() === '停止中...' &&
          button.disabled &&
          button.classList.contains('stopping') &&
          button.getAttribute('aria-busy') === 'true'
        )`,
    )
    const cancelCountDuring = await evaluate(
      client,
      `window.__mockSnapshot().requests.filter((request) => request.pathname.endsWith('/cancel')).length`,
    )
    if (cancelCountDuring - cancelCountBefore !== 1) {
      throw new Error(`Repeated stop caused duplicate cancel requests: ${cancelCountDuring - cancelCountBefore}`)
    }
    await waitFor(client, `document.body.innerText.includes('已停止生成') && [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送')`)
    await setMockFlags(client, { cancelDelayMs: 0 })
    await screenshot(client, '01-repeat-stop')

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      chunks: ['这是可以复制的助手回复。'],
      interval: 40,
    }])
    await ask(client, '测试复制')
    await waitFor(client, `document.body.innerText.includes('这是可以复制的助手回复。') && document.body.innerText.includes('复制')`)
    await waitIdle(client)
    await ensureClipboard(client)
    await clickText(client, 'button', '复制')
    await waitFor(client, `document.body.innerText.includes('已复制')`)
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((node) => node.textContent.trim() === '已复制');
        button?.focus();
      })()`,
    )
    await screenshot(client, '02-copy-shows-copied')

    await resetPage(client)
    await setPlan(client, [
      { kind: 'streamError', message: '模拟失败，请重试' },
      { kind: 'success', chunks: ['重试后在原位置生成成功。'], interval: 40 },
    ])
    await ask(client, '测试失败重试')
    await waitFor(client, `document.body.innerText.includes('模拟失败，请重试') && document.body.innerText.includes('重试')`)
    await waitIdle(client)
    await screenshot(client, '03-failed-message-retry-button')
    await clickText(client, 'button', '重试')
    await waitFor(client, `document.body.innerText.includes('重试后在原位置生成成功。') && !document.body.innerText.includes('模拟失败，请重试')`)
    await waitIdle(client)
    const retryState = await evaluate(
      client,
      `(() => ({
        userRows: [...document.querySelectorAll('.message-row.user')].length,
        assistantRows: [...document.querySelectorAll('.message-row.assistant')].length,
        askCount: window.__askCount,
        text: document.querySelector('.message-list')?.innerText,
      }))()`,
    )
    await screenshot(client, '03-retry-regenerated-same-slot')

    await resetPage(client)
    await setPlan(client, [
      { kind: 'success', chunks: makeLongChunks('历史回复 A', 16), interval: 1 },
      { kind: 'success', chunks: makeLongChunks('历史回复 B', 16), interval: 1 },
      { kind: 'success', chunks: makeLongChunks('历史回复 C', 16), interval: 1 },
      { kind: 'success', chunks: makeLongChunks('新流式回复', 40), interval: 120, done: false },
    ])
    await ask(client, '历史问题 A')
    await waitFor(client, `document.body.innerText.includes('历史回复 A 16.')`)
    await waitIdle(client)
    await ask(client, '历史问题 B')
    await waitFor(client, `document.body.innerText.includes('历史回复 B 16.')`)
    await waitIdle(client)
    await ask(client, '历史问题 C')
    await waitFor(client, `document.body.innerText.includes('历史回复 C 16.')`)
    await waitIdle(client)
    await evaluate(client, `document.querySelector('.chat-scroll').scrollTop = document.querySelector('.chat-scroll').scrollHeight`)
    await delay(100)
    const bottomGapAtBottom = await evaluate(client, `(() => {
      const el = document.querySelector('.chat-scroll');
      return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    })()`)
    if (bottomGapAtBottom > 96) {
      throw new Error(`Scroll follow near bottom failed: bottomGapAtBottom=${bottomGapAtBottom}`)
    }
    await ask(client, '接近底部时跟随新内容')
    await delay(900)
    const bottomGapFollow = await evaluate(client, `(() => {
      const el = document.querySelector('.chat-scroll');
      return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    })()`)
    if (bottomGapFollow > 96) {
      throw new Error(`Scroll follow during streaming failed: bottomGapFollow=${bottomGapFollow}`)
    }
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    await waitIdle(client)

    await setPlan(client, [
      { kind: 'success', chunks: makeLongChunks('新流式回复', 40), interval: 120, done: false },
    ])
    await evaluate(client, `document.querySelector('.chat-scroll').scrollTop = 0`)
    const scrollBefore = await evaluate(client, `Math.round(document.querySelector('.chat-scroll').scrollTop)`)
    const bottomGapBefore = await evaluate(client, `(() => {
      const el = document.querySelector('.chat-scroll');
      return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    })()`)
    await ask(client, '新内容生成时我正在看历史')
    await delay(1200)
    const scrollDuring = await evaluate(client, `Math.round(document.querySelector('.chat-scroll').scrollTop)`)
    const bottomGap = await evaluate(client, `(() => {
      const el = document.querySelector('.chat-scroll');
      return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    })()`)
    if (bottomGapBefore <= 96 || bottomGap <= 96) {
      throw new Error(
        `Scroll follow guard failed: bottomGapBefore=${bottomGapBefore}, bottomGap=${bottomGap}, scrollBefore=${scrollBefore}, scrollDuring=${scrollDuring}`,
      )
    }
    await screenshot(client, '04-scroll-does-not-force-bottom')
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      chunks: ['新建前正在生成。', '这条请求应该被中断。'],
      interval: 300,
      done: false,
    }])
    await ask(client, '测试新建时中断')
    await waitFor(client, `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`)
    await clickText(client, 'button', '新建')
    await waitFor(
      client,
      `document.querySelector('.empty-state') &&
        document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.includes('0 条消息')`,
    )
    const newChatAbortCount = await waitFor(client, `window.__abortCount > 0 && window.__abortCount`)
    await screenshot(client, '05-new-chat-aborts-generation')

    console.log('UI stage: switch and generating operations')
    await resetPage(client)
    await setPlan(client, [
      { kind: 'success', chunks: ['第一会话历史内容。'], interval: 20 },
      { kind: 'success', chunks: ['第二会话正在生成。', '第二会话后续内容。'], interval: 250, done: false },
    ])
    await ask(client, '第一会话问题')
    await waitFor(client, `document.body.innerText.includes('第一会话历史内容。')`)
    await waitIdle(client)
    await clickText(client, 'button', '新建')
    await waitFor(client, `document.querySelector('.empty-state')`)
    await ask(client, '第二会话生成中')
    await waitFor(client, `document.body.innerText.includes('第二会话正在生成。')`)
    await clickConversationAt(client, 1)
    await waitFor(client, `document.body.innerText.includes('第一会话历史内容。') && !document.body.innerText.includes('第二会话正在生成。')`)
    const switchAbortCount = await waitFor(client, `window.__abortCount > 0 && window.__abortCount`)

    console.log('UI stage: composer draft reset across conversations')
    await resetPage(client)
    await setPlan(client, [{ kind: 'success', chunks: ['第一会话已保存。'], interval: 20 }])
    await ask(client, '第一会话问题')
    await waitFor(client, `document.body.innerText.includes('第一会话已保存。')`)
    await waitIdle(client)
    await typeText(client, '新建前未发送草稿')
    await clickText(client, 'button', '新建')
    await waitFor(
      client,
      `document.querySelector('.empty-state') && document.querySelector('textarea')?.value === ''`,
    )
    const newChatDraftValue = await evaluate(client, `document.querySelector('textarea')?.value`)

    await typeText(client, '第二会话未发送草稿')
    await clickConversationAt(client, 1)
    await waitFor(
      client,
      `document.body.innerText.includes('第一会话已保存。') &&
        document.querySelector('textarea')?.value === ''`,
    )
    const switchDraftValue = await evaluate(client, `document.querySelector('textarea')?.value`)

    await typeText(client, '删除当前会话前未发送草稿')
    await evaluate(
      client,
      `(() => {
        const button = document.querySelector('.conversation-item-shell.active .conversation-action-btn.danger');
        if (!button) throw new Error('Cannot find active delete button');
        button.click();
      })()`,
    )
    await waitForDialog(client, '删除会话')
    await confirmDialog(client, '删除')
    await waitFor(
      client,
      `document.querySelector('.empty-state') &&
        document.querySelector('textarea')?.value === '' &&
        document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.includes('0 条消息')`,
    )
    const deleteDraftState = await evaluate(
      client,
      `(() => ({
        value: document.querySelector('textarea')?.value,
        activeCount: document.querySelectorAll('.conversation-item-shell.active').length,
        activeMeta: document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.trim(),
      }))()`,
    )
    if (newChatDraftValue !== '' || switchDraftValue !== '' || deleteDraftState.value !== '') {
      throw new Error(
        `Composer draft reset failed: ${JSON.stringify({
          newChatDraftValue,
          switchDraftValue,
          deleteDraftState,
        })}`,
      )
    }

    await setPlan(client, [{ kind: 'success', chunks: ['清空前会话内容。'], interval: 20 }])
    await ask(client, '清空当前会话前的问题')
    await waitFor(client, `document.body.innerText.includes('清空前会话内容。')`)
    await waitIdle(client)
    await typeText(client, '清空当前会话前未发送草稿')
    await clickText(client, 'button', '清空当前会话')
    await waitForDialog(client, '清空当前会话')
    await confirmDialog(client, '清空')
    await waitFor(
      client,
      `document.querySelector('.empty-state') &&
        document.querySelector('textarea')?.value === '' &&
        document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.includes('0 条消息')`,
    )
    const clearDraftState = await evaluate(
      client,
      `(() => ({
        value: document.querySelector('textarea')?.value,
        activeMeta: document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.trim(),
        isEmpty: Boolean(document.querySelector('.empty-state')),
      }))()`,
    )
    if (clearDraftState.value !== '' || !clearDraftState.isEmpty) {
      throw new Error(`Clear conversation draft reset failed: ${JSON.stringify(clearDraftState)}`)
    }

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      chunks: ['生成中会话操作内容。'],
      interval: 300,
      done: false,
    }])
    await ask(client, '生成中操作')
    await waitFor(client, `document.body.innerText.includes('生成中会话操作内容。')`)
    const operationState = await evaluate(
      client,
      `(() => {
        const beforeTitles = [...document.querySelectorAll('.conversation-title')].map((node) => node.textContent.trim());
        const clearDisabled = document.querySelector('.clear-history-btn')?.disabled === true;
        const importDisabled = [...document.querySelectorAll('button')]
          .find((button) => button.textContent.trim() === '导入 JSON')?.disabled === true;
        const exportAllDisabled = [...document.querySelectorAll('button')]
          .find((button) => button.textContent.trim() === '导出全部 JSON')?.disabled === true;
        const singleExportDisabled = [...document.querySelectorAll('.conversation-action-btn')]
          .filter((button) => button.getAttribute('title') === '导出 Markdown')
          .every((button) => button.disabled === true);
        document.querySelector('.conversation-action-btn.danger')?.click();
        const afterDeleteTitles = [...document.querySelectorAll('.conversation-title')].map((node) => node.textContent.trim());
        document.querySelector('.conversation-action-btn[title="重命名"]')?.click();
        return {
          clearDisabled,
          importDisabled,
          exportAllDisabled,
          singleExportDisabled,
          beforeCount: beforeTitles.length,
          afterDeleteCount: afterDeleteTitles.length,
        };
      })()`,
    )
    await waitForDialog(client, '重命名会话')
    await submitPromptDialog(client, '生成中重命名成功')
    await waitFor(client, `document.body.innerText.includes('生成中重命名成功')`)
    if (
      !operationState.clearDisabled ||
      !operationState.importDisabled ||
      !operationState.exportAllDisabled ||
      !operationState.singleExportDisabled ||
      operationState.beforeCount !== operationState.afterDeleteCount
    ) {
      throw new Error('Generating conversation operation state failed')
    }
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    await waitIdle(client)

    await resetPage(client)
    await typeText(client, '   ')
    const blankSubmitState = await evaluate(
      client,
      `(() => {
        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return {
          askCount: window.__askCount,
          sendDisabled: [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '发送')?.disabled === true,
        };
      })()`,
    )
    await setPlan(client, [{ kind: 'success', chunks: ['Enter 提交成功。'], interval: 20 }])
    await typeText(client, 'Enter 提交')
    await evaluate(
      client,
      `document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }))`,
    )
    await waitFor(client, `document.body.innerText.includes('Enter 提交成功。')`)
    await waitIdle(client)
    const enterSubmitCount = await evaluate(client, `window.__askCount`)
    await typeText(client, 'Shift Enter 不提交')
    await evaluate(
      client,
      `document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }))`,
    )
    await delay(200)
    const shiftEnterSubmitCount = await evaluate(client, `window.__askCount`)
    await typeText(client, Array.from({ length: 12 }, (_, index) => '多行输入内容 ' + index).join('\\n'))
    const tallHeight = await evaluate(client, `document.querySelector('textarea').offsetHeight`)
    await setPlan(client, [{ kind: 'success', chunks: ['输入框恢复成功。'], interval: 20 }])
    await ask(client, '输入框发送后恢复')
    await waitFor(client, `document.body.innerText.includes('输入框恢复成功。')`)
    await waitIdle(client)
    const composerState = await evaluate(
      client,
      `(() => ({
        blankAskCount: ${blankSubmitState.askCount},
        blankSendDisabled: ${blankSubmitState.sendDisabled},
        enterSubmitCount: ${enterSubmitCount},
        shiftEnterSubmitCount: ${shiftEnterSubmitCount},
        tallHeight: ${tallHeight},
        finalHeight: document.querySelector('textarea').offsetHeight,
        textareaDisabled: document.querySelector('textarea').disabled,
      }))()`,
    )
    if (
      !composerState.blankSendDisabled ||
      composerState.enterSubmitCount !== composerState.blankAskCount + 1 ||
      composerState.shiftEnterSubmitCount !== composerState.enterSubmitCount ||
      composerState.tallHeight <= composerState.finalHeight
    ) {
      throw new Error('Composer behavior assertions failed')
    }

    console.log('UI stage: suggestions and theme')
    await resetPage(client)
    await clickFirstSuggestion(client)
    const suggestionState = await evaluate(
      client,
      `(() => ({
        value: document.querySelector('textarea').value,
        askCount: window.__askCount,
      }))()`,
    )
    if (!suggestionState.value.trim() || suggestionState.askCount !== 0) {
      throw new Error('Suggestion behavior assertions failed')
    }
    await setPlan(client, [{ kind: 'success', chunks: ['生成中 suggestion 不并发。'], interval: 300, done: false }])
    await ask(client, '生成中 suggestion')
    await waitFor(client, `document.body.innerText.includes('生成中 suggestion 不并发。')`)
    const suggestionDuringGeneration = await evaluate(
      client,
      `(() => ({
        askCount: window.__askCount,
        suggestionCount: document.querySelectorAll('.suggestion-card').length,
      }))()`,
    )
    if (suggestionDuringGeneration.askCount !== 1 || suggestionDuringGeneration.suggestionCount !== 0) {
      throw new Error('Suggestion caused concurrent request while generating')
    }
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)

    await resetPage(client)
    const initialTheme = await evaluate(client, `document.querySelector('.app-shell')?.dataset.theme`)
    await clickText(client, 'button', initialTheme === 'dark' ? '浅色' : '深色')
    const toggledTheme = await evaluate(client, `document.querySelector('.app-shell')?.dataset.theme`)
    await client.send('Page.reload')
    await waitFor(client, `document.querySelector('.app-shell')?.dataset.theme === ${JSON.stringify(toggledTheme)}`)
    await waitFor(client, `document.querySelector('textarea') && document.querySelector('form')`)
    const themePersistenceState = await evaluate(
      client,
      `(() => ({
        theme: document.querySelector('.app-shell')?.dataset.theme,
        storedTheme: localStorage.getItem('chatbot-theme'),
      }))()`,
    )
    if (themePersistenceState.theme !== toggledTheme || themePersistenceState.storedTheme !== toggledTheme) {
      throw new Error(`Theme persistence failed: ${JSON.stringify(themePersistenceState)}`)
    }
    await setPlan(client, [{ kind: 'success', chunks: ['主题切换生成中保持。'], interval: 300, done: false }])
    await ask(client, '主题生成中')
    await waitFor(client, `document.body.innerText.includes('主题切换生成中保持。')`)
    await clickText(client, 'button', toggledTheme === 'dark' ? '浅色' : '深色')
    const themeStreamingState = await evaluate(
      client,
      `(() => ({
        stillGenerating: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止'),
        theme: document.querySelector('.app-shell')?.dataset.theme,
      }))()`,
    )
    if (!themeStreamingState.stillGenerating || themeStreamingState.theme === toggledTheme) {
      throw new Error('Theme toggle during streaming failed')
    }
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)

    await resetPage(client)
    await setPlan(client, [{ kind: 'success', chunks: ['刷新恢复当前会话内容。'], interval: 20 }])
    await ask(client, '刷新恢复当前会话')
    await waitFor(client, `document.body.innerText.includes('刷新恢复当前会话内容。')`)
    await waitIdle(client)
    await typeText(client, '刷新前草稿会清空')
    await client.send('Page.reload')
    await waitFor(
      client,
      `document.body.innerText.includes('刷新恢复当前会话内容。') &&
        document.querySelector('textarea')?.value === '' &&
        document.querySelectorAll('.conversation-item-shell.active').length === 1`,
    )
    const reloadRecoveryState = await evaluate(
      client,
      `(() => ({
        hasMessage: document.body.innerText.includes('刷新恢复当前会话内容。'),
        draftValue: document.querySelector('textarea')?.value,
        activeCount: document.querySelectorAll('.conversation-item-shell.active').length,
      }))()`,
    )
    if (!reloadRecoveryState.hasMessage || reloadRecoveryState.draftValue !== '' || reloadRecoveryState.activeCount !== 1) {
      throw new Error(`Reload recovery failed: ${JSON.stringify(reloadRecoveryState)}`)
    }

    console.log('UI stage: mobile layout and frontend errors')
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      chunks: ['移动端长消息 '.repeat(80)],
      interval: 20,
    }])
    await ask(client, '移动端布局')
    await waitFor(client, `document.body.innerText.includes('移动端长消息')`)
    await waitIdle(client)
    await evaluate(
      client,
      `(() => {
        const chatScroll = document.querySelector('.chat-scroll');
        chatScroll?.scrollTo({ top: chatScroll.scrollHeight });
      })()`,
    )
    await waitFor(
      client,
      `(() => {
        const chatScroll = document.querySelector('.chat-scroll');
        return chatScroll && Math.abs(chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight) <= 24;
      })()`,
    )
    const mobileState = await evaluate(
      client,
      `(() => {
        const composer = document.querySelector('.composer');
        const chatScroll = document.querySelector('.chat-scroll');
        const composerRect = composer.getBoundingClientRect();
        const chatScrollRect = chatScroll.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
          composerOverlapsScroll: composerRect.top < chatScrollRect.bottom - 1,
          scrollBottomGap: Math.round(Math.abs(chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight)),
          shellWidth: document.querySelector('.app-shell').getBoundingClientRect().width,
        };
      })()`,
    )
    if (
      mobileState.pageOverflowX ||
      mobileState.composerOverlapsScroll ||
      mobileState.scrollBottomGap > 24 ||
      mobileState.shellWidth > 390
    ) {
      throw new Error(`Mobile layout failed: ${JSON.stringify(mobileState)}`)
    }
    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      reasoningChunks: ['移动端 reasoning 长文本 '.repeat(80)],
      chunks: ['移动端 reasoning 正文。'],
      interval: 20,
    }])
    await ask(client, '移动端 reasoning 布局')
    await waitFor(client, `document.body.innerText.includes('移动端 reasoning 正文。')`)
    await waitIdle(client)
    const mobileReasoningState = await evaluate(
      client,
      `(() => {
        const panel = document.querySelector('.reasoning-panel');
        const body = document.querySelector('.reasoning-content-body');
        return {
          hasPanel: Boolean(panel),
          pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
          panelWidth: Math.ceil(panel?.getBoundingClientRect().width || 0),
          bodyWidth: Math.ceil(body?.getBoundingClientRect().width || 0),
          viewportWidth: window.innerWidth,
        };
      })()`,
    )
    if (
      !mobileReasoningState.hasPanel ||
      mobileReasoningState.pageOverflowX ||
      mobileReasoningState.panelWidth > mobileReasoningState.viewportWidth ||
      mobileReasoningState.bodyWidth > mobileReasoningState.viewportWidth
    ) {
      throw new Error(`Mobile reasoning layout failed: ${JSON.stringify(mobileReasoningState)}`)
    }
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    console.log('UI stage: send failures, timeout, done handling, and fast actions')
    await resetPage(client)
    await setPlan(client, [
      { kind: 'httpError', status: 500 },
      { kind: 'networkError', message: 'Failed to fetch' },
      { kind: 'abruptClose', chunks: ['部分正文已经到达。'], interval: 20, message: 'network lost' },
      { kind: 'extraAfterDone', chunks: ['done 前内容。'], extraContent: 'done 后不应显示。', interval: 20 },
      { kind: 'success', chunks: ['快速点击只发送一次。'], interval: 80 },
      { kind: 'success', chunks: ['超时后恢复成功。'], interval: 20 },
    ])
    await ask(client, 'HTTP 500 错误')
    await waitFor(client, `document.body.innerText.includes('请求失败：500')`)
    await waitIdle(client)
    await ask(client, '网络错误')
    await waitFor(client, `document.body.innerText.includes('Failed to fetch')`)
    await waitIdle(client)
    await ask(client, '中途网络断开')
    await waitFor(
      client,
      `document.body.innerText.includes('部分正文已经到达。') &&
        document.body.innerText.includes('响应中断') &&
        document.body.innerText.includes('复制') &&
        document.body.innerText.includes('重试')`,
    )
    await waitIdle(client)
    await ask(client, 'done 后多余内容')
    await waitFor(client, `document.body.innerText.includes('done 前内容。')`)
    await waitIdle(client)
    const extraAfterDoneState = await evaluate(
      client,
      `(() => ({
        hasExpected: document.body.innerText.includes('done 前内容。'),
        hasExtra: document.body.innerText.includes('done 后不应显示。'),
      }))()`,
    )
    if (!extraAfterDoneState.hasExpected || extraAfterDoneState.hasExtra) {
      throw new Error(`Extra after done was rendered: ${JSON.stringify(extraAfterDoneState)}`)
    }

    const fastBeforeAskCount = await evaluate(client, `window.__askCount`)
    await typeText(client, '快速连续点击发送')
    await evaluate(
      client,
      `(() => {
        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      })()`,
    )
    await waitFor(client, `document.body.innerText.includes('快速点击只发送一次。')`)
    await waitIdle(client)
    const fastSubmitState = await evaluate(
      client,
      `(() => ({
        askCountDelta: window.__askCount - ${fastBeforeAskCount},
        userRows: [...document.querySelectorAll('.message-row.user')]
          .filter((row) => row.innerText.includes('快速连续点击发送')).length,
      }))()`,
    )
    if (fastSubmitState.askCountDelta !== 1 || fastSubmitState.userRows !== 1) {
      throw new Error(`Fast submit caused duplicate request: ${JSON.stringify(fastSubmitState)}`)
    }

    await setPlan(client, [
      { kind: 'success', chunks: ['这条不会及时返回。'], firstDelay: 16000, interval: 20 },
      { kind: 'success', chunks: ['超时后恢复成功。'], interval: 20 },
    ])
    await ask(client, '等待超时')
    await waitFor(client, `document.body.innerText.includes('响应超时或连接中断')`, 20000)
    await waitIdle(client)
    await ask(client, '超时后恢复')
    await waitFor(client, `document.body.innerText.includes('超时后恢复成功。')`)
    await waitIdle(client)
    const timeoutRecoveryState = await evaluate(
      client,
      `(() => ({
        hasTimeout: document.body.innerText.includes('响应超时或连接中断'),
        hasRecovery: document.body.innerText.includes('超时后恢复成功。'),
      }))()`,
    )
    if (!timeoutRecoveryState.hasTimeout || !timeoutRecoveryState.hasRecovery) {
      throw new Error(`Timeout recovery failed: ${JSON.stringify(timeoutRecoveryState)}`)
    }

    await resetPage(client)
    await setPlan(client, [
      { kind: 'malformedNdjson' },
      { kind: 'noDoneClose', chunks: ['没有 done 的响应。'], interval: 20 },
      { kind: 'success', chunks: ['异常后恢复成功。'], interval: 20 },
    ])
    await ask(client, '前端损坏 NDJSON')
    await waitFor(client, `document.body.innerText.includes('Unexpected') || document.body.innerText.includes('JSON')`)
    await waitIdle(client)
    await ask(client, '前端没有 done')
    await waitFor(client, `document.body.innerText.includes('响应未完整结束')`)
    await waitIdle(client)
    await ask(client, '前端异常后恢复')
    await waitFor(client, `document.body.innerText.includes('异常后恢复成功。')`)

    console.log(JSON.stringify({
      retryState,
      scrollBefore,
      bottomGapAtBottom,
      bottomGapFollow,
      bottomGapBefore,
      scrollDuring,
      bottomGap,
      newChatAbortCount,
      switchAbortCount,
      streamingActionState,
      stoppedActionState,
      newChatDraftValue,
      switchDraftValue,
      deleteDraftState,
      clearDraftState,
      operationState,
      composerState,
      suggestionState,
      suggestionDuringGeneration,
      themePersistenceState,
      themeStreamingState,
      reloadRecoveryState,
      mobileState,
      mobileReasoningState,
      reasoningState,
      reasoningAbortCount,
      reasoningExpanded,
      reasoningCollapsed,
      reasoningMarkdownState,
      extraAfterDoneState,
      fastSubmitState,
      timeoutRecoveryState,
    }, null, 2))

    client.close()
  } finally {
    await stopProcess(chrome)
    await rm(profileDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
