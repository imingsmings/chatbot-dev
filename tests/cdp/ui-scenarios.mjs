import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
  await client.send('Page.navigate', { url: APP_URL })
  await waitFor(client, 'document.querySelector("textarea") && document.querySelector(".empty-state")')
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
  const conversations = new Map();
  window.__abortCount = 0;
  window.__askCount = 0;

  window.__setAskPlans = (nextPlans) => {
    plans = nextPlans.slice();
    window.__abortCount = 0;
    window.__askCount = 0;
  };

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
    return conversation;
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const parsed = new URL(url, window.location.origin);
    const pathname = parsed.pathname.replace(/^\\/api/, '');
    const method = (init.method || 'GET').toUpperCase();

    if (pathname === '/conversations' && method === 'GET') {
      return json({ conversations: [...conversations.values()].map(summary) });
    }

    if (pathname === '/conversations' && method === 'POST') {
      const body = JSON.parse(init.body || '{}');
      const conversation = createConversation(body.title || '新的聊天');
      return json({ conversation }, 201);
    }

    const detailMatch = pathname.match(/^\\/conversations\\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      return conversation ? json({ conversation }) : json({ message: 'not found' }, 404);
    }

    if (detailMatch && method === 'PATCH') {
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      const body = JSON.parse(init.body || '{}');
      conversation.title = body.title || conversation.title;
      conversation.updatedAt = now();
      return json({ conversation });
    }

    if (detailMatch && method === 'DELETE') {
      const id = decodeURIComponent(detailMatch[1]);
      if (!conversations.has(id)) return json({ message: 'not found' }, 404);
      conversations.delete(id);
      return new Response('', { status: 204 });
    }

    const clearMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/clear$/);
    if (clearMatch && method === 'POST') {
      const conversation = conversations.get(decodeURIComponent(clearMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      conversation.messages = [];
      conversation.updatedAt = now();
      return json({ conversation });
    }

    const askMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/ask$/);

    if (pathname.startsWith('/requests/') && pathname.endsWith('/cancel') && method === 'POST') {
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

    const stream = new ReadableStream({
      start(controller) {
        let index = 0;
        let answer = '';
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

          if (index < (plan.chunks || []).length) {
            const chunk = plan.chunks[index];
            answer += chunk;
            controller.enqueue(line({ type: 'delta', content: chunk }));
            index += 1;
            timer = window.setTimeout(push, plan.interval ?? 80);
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

          controller.enqueue(line({ type: 'done' }));
          conversation.messages.push(
            { role: 'user', content: question },
            { role: 'assistant', content: answer },
          );
          conversation.updatedAt = now();
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
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
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
    client.on('Page.javascriptDialogOpening', () => {
      client.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
    })
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
    await screenshot(client, '01-generating-stop-button')
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成') && [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送')`)
    await screenshot(client, '01-stopped-after-click')
    await ensureClipboard(client)
    await clickText(client, 'button', '复制')
    await waitFor(client, `document.body.innerText.includes('已复制')`)
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
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((node) => node.textContent.trim() === '停止');
        button?.click();
        button?.click();
      })()`,
    )
    await waitFor(client, `document.body.innerText.includes('已停止生成') && [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送')`)
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
        window.prompt = () => '生成中重命名成功';
        const beforeTitles = [...document.querySelectorAll('.conversation-title')].map((node) => node.textContent.trim());
        const clearDisabled = document.querySelector('.clear-history-btn')?.disabled === true;
        document.querySelector('.conversation-action-btn.danger')?.click();
        const afterDeleteTitles = [...document.querySelectorAll('.conversation-title')].map((node) => node.textContent.trim());
        document.querySelector('.conversation-action-btn[title="重命名"]')?.click();
        return {
          clearDisabled,
          beforeCount: beforeTitles.length,
          afterDeleteCount: afterDeleteTitles.length,
        };
      })()`,
    )
    await waitFor(client, `document.body.innerText.includes('生成中重命名成功')`)
    if (!operationState.clearDisabled || operationState.beforeCount !== operationState.afterDeleteCount) {
      throw new Error('Generating conversation operation state failed')
    }
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)

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
    await waitFor(
      client,
      `(() => {
        const chatScroll = document.querySelector('.chat-scroll');
        return chatScroll && Math.abs(chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight) < 8;
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
          scrollBottomGap: Math.abs(chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight),
          shellWidth: document.querySelector('.app-shell').getBoundingClientRect().width,
        };
      })()`,
    )
    if (
      mobileState.pageOverflowX ||
      mobileState.composerOverlapsScroll ||
      mobileState.scrollBottomGap > 8 ||
      mobileState.shellWidth > 390
    ) {
      throw new Error(`Mobile layout failed: ${JSON.stringify(mobileState)}`)
    }
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

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
      operationState,
      composerState,
      suggestionState,
      suggestionDuringGeneration,
      themeStreamingState,
      mobileState,
    }, null, 2))

    client.close()
  } finally {
    chrome.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
