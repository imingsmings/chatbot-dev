import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const VITE_PORT = process.env.VITE_PORT || new URL(APP_URL).port || '5173'
const CLIENT_DIR = process.env.CDP_CLIENT_DIR || 'client'
const SERVER_PORT = process.env.SERVER_PORT || '7701'
const SERVER_URL = process.env.SERVER_URL || `http://127.0.0.1:${SERVER_PORT}`
const MOCK_PORT = Number(process.env.MOCK_PORT || 7011)
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}/chat/completions`
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9337)
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-upstream-abort-screenshots')
const RESULT_FILE = path.resolve(OUT_DIR, 'results.json')
const VITE_TEST_CONFIG = path.resolve(process.cwd(), '.tmp/vite-abort-test.config.mjs')
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()

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

      const callbacks = this.listeners.get(payload.method)
      callbacks?.forEach((callback) => callback(payload.params || {}))
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  on(method, callback) {
    const callbacks = this.listeners.get(method) || []
    callbacks.push(callback)
    this.listeners.set(method, callbacks)
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
      if (response.ok || response.status < 500) return
    } catch {
      // keep polling
    }

    await delay(200)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function waitUntil(predicate, timeoutMs = 15000, label = 'condition') {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const value = await predicate()
    if (value) return value
    await delay(100)
  }

  throw new Error(`Timed out waiting for ${label}`)
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

async function waitFor(client, expression, timeoutMs = 15000) {
  return waitUntil(() => evaluate(client, expression), timeoutMs, expression)
}

async function screenshot(client, name) {
  if (!CAPTURE_SCREENSHOTS) return null
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })
  const filePath = path.join(OUT_DIR, `${name}.png`)
  await writeFile(filePath, Buffer.from(result.data, 'base64'))
  return filePath
}

async function ask(client, question) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('textarea');
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      valueSetter.call(input, ${JSON.stringify(question)});
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

async function waitStop(client) {
  await waitFor(
    client,
    `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`,
  )
}

async function waitIdle(client) {
  await waitFor(
    client,
    `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送') &&
      ![...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`,
  )
}

async function waitAssistantStreamingText(client) {
  await waitFor(
    client,
    `document.querySelector('.message-row.assistant:not(.pending) .message-text')?.textContent.trim().length > 0`,
  )
}

async function newChat(client) {
  const previousCount = await evaluate(client, `window.__abortTest.createdIds.length`)
  const previousId = await evaluate(client, `window.__abortTest.createdIds.at(-1) ?? null`)
  await clickText(client, 'button', '新建')
  await waitFor(client, `document.querySelector('.conversation-item-shell.active')?.textContent.includes('0 条消息')`)
  await waitFor(client, `Boolean(document.querySelector('.empty-state') && document.querySelector('textarea'))`)
  const createdIds = await evaluate(client, `window.__abortTest.createdIds`)
  const id = createdIds.length > previousCount ? createdIds.at(-1) : previousId
  if (!id) {
    throw new Error('New-chat action did not create or reuse an empty conversation')
  }
  return id
}

async function showOverlay(client, title, rows) {
  await evaluate(
    client,
    `(() => {
      document.querySelector('#cdp-abort-overlay')?.remove();
      const box = document.createElement('div');
      box.id = 'cdp-abort-overlay';
      box.style.cssText = [
        'position:fixed',
        'right:18px',
        'bottom:18px',
        'z-index:99999',
        'max-width:560px',
        'padding:14px 16px',
        'background:rgba(17,24,39,0.94)',
        'color:#fff',
        'font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
        'border-radius:8px',
        'box-shadow:0 16px 45px rgba(0,0,0,0.28)',
        'white-space:pre-wrap'
      ].join(';');
      box.textContent = ${JSON.stringify(`${title}\n${rows.join('\n')}`)};
      document.body.appendChild(box);
    })()`,
  )
}

async function getMessageCounts(id) {
  const response = await fetch(`${SERVER_URL}/conversations/${encodeURIComponent(id)}`)
  if (!response.ok) return null
  const data = await response.json()
  return data.conversation.messages.length
}

async function getConversationMessages(id) {
  const response = await fetch(`${SERVER_URL}/conversations/${encodeURIComponent(id)}`)
  if (!response.ok) return null
  const data = await response.json()
  return data.conversation.messages
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

function createMockLlmServer() {
  const records = []
  let nextId = 1

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.writeHead(404)
      res.end()
      return
    }

    const id = nextId++
    const startedAt = Date.now()
    const raw = await collectBody(req)
    const body = JSON.parse(raw || '{}')
    const promptText = JSON.stringify(body.messages || [])
    const stage = body.tools?.length && promptText.includes('[TC02]') ? 'tool-decision' : 'answer'
    const record = {
      id,
      stream: Boolean(body.stream),
      stage,
      marker: promptText.match(/\[TC\d+\]/)?.[0] || 'unknown',
      startedAt,
      chunksSent: 0,
      responseEnded: false,
      responseClosed: false,
      closeBeforeEnd: false,
      closeAfterMs: null,
    }
    records.push(record)

    res.on('close', () => {
      record.responseClosed = true
      record.closeAfterMs = Date.now() - startedAt
      record.closeBeforeEnd = !record.responseEnded
    })

    const safeWrite = (chunk) => {
      if (res.destroyed || res.writableEnded) return false
      res.write(chunk)
      return true
    }

    if (!body.stream) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      record.responseEnded = true
      res.end(JSON.stringify({ message: 'expected streaming request' }))
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    if (stage === 'tool-decision') {
      const waitMs = record.marker === '[TC02]' ? 5000 : 80
      await delay(waitMs)

      if (safeWrite(`data: ${JSON.stringify({ choices: [{ delta: { content: '无函数调用' } }] })}\n\n`)) {
        record.chunksSent += 1
      } else {
        return
      }

      if (safeWrite('data: [DONE]\n\n')) {
        record.responseEnded = true
        res.end()
      }
      return
    }

    if (record.marker === '[TC08]') {
      await delay(5000)
    }

    const words = Array.from({ length: 120 }, (_, index) => `片段${index + 1} `)

    for (const word of words) {
      if (!safeWrite(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`)) {
        return
      }
      record.chunksSent += 1
      await delay(90)
    }

    if (safeWrite('data: [DONE]\n\n')) {
      record.responseEnded = true
      res.end()
    }
  })

  return {
    records,
    server,
    start: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(MOCK_PORT, '127.0.0.1', resolve)
      }),
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      }),
  }
}

function spawnProcess(command, args, options) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })

  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))

  return child
}

async function stopProcess(child) {
  if (!child || child.killed) return
  child.kill('SIGTERM')
  await delay(600)
  if (!child.killed) child.kill('SIGKILL')
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-abort-data-'))
  const clientRoot = path.resolve(process.cwd(), CLIENT_DIR)
  const viteImport = pathToFileURL(path.resolve(clientRoot, 'node_modules/vite/dist/node/index.js')).href
  const clientConfigImport = pathToFileURL(path.resolve(clientRoot, 'vite.config.ts')).href
  await writeFile(
    VITE_TEST_CONFIG,
    `import { defineConfig } from ${JSON.stringify(viteImport)}
import clientConfig from ${JSON.stringify(clientConfigImport)}

export default defineConfig({
  ...clientConfig,
  root: ${JSON.stringify(clientRoot)},
  server: {
    ...clientConfig.server,
    proxy: {
      '/api': {
        target: ${JSON.stringify(SERVER_URL)},
        changeOrigin: true,
      },
    },
  },
})
`,
    'utf8',
  )

  const mock = createMockLlmServer()
  await mock.start()

  const server = spawnProcess('node', ['./bin/www.ts'], {
    cwd: path.resolve(process.cwd(), 'server'),
    env: {
      ...process.env,
      AUTH_ENABLED: 'false',
      PORT: SERVER_PORT,
      LLM_PROVIDER: 'deepseek',
      LLM_ENDPOINT: MOCK_URL,
      LLM_MODEL: 'cdp-abort-test',
      LLM_TIMEOUT_MS: '20000',
      DEEPSEEK_API_KEY: 'cdp-test-key',
      CONVERSATION_DATA_DIR: dataDir,
    },
  })

  const vite = spawnProcess('pnpm', ['exec', 'vite', '--config', VITE_TEST_CONFIG, '--configLoader', 'native', '--host', '127.0.0.1', '--port', VITE_PORT, '--strictPort'], {
    cwd: clientRoot,
    env: process.env,
  })

  const profileDir = await mkdtemp(path.join(tmpdir(), 'chatbot-abort-cdp-'))
  const chrome = spawnProcess(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars=false',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1280,900',
    'about:blank',
  ])

  const askRequests = new Map()
  const screenshots = []
  const results = []
  let client

  try {
    await waitForHttp(`${SERVER_URL}/conversations`)
    await waitForHttp(APP_URL)
    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`)

    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP_URL)}`, {
      method: 'PUT',
    })

    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
    const target =
      targets.find((item) => item.type === 'page' && item.url.startsWith(APP_URL)) ||
      targets.find((item) => item.type === 'page')
    client = new CdpClient(target.webSocketDebuggerUrl)

    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Network.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    client.on('Network.requestWillBeSent', (event) => {
      if (event.request?.url?.includes('/api/conversations/') && event.request.url.includes('/ask')) {
        askRequests.set(event.requestId, {
          url: event.request.url,
          failed: false,
          finished: false,
          canceled: false,
          errorText: '',
        })
      }
    })
    client.on('Network.loadingFailed', (event) => {
      const item = askRequests.get(event.requestId)
      if (item) {
        item.failed = true
        item.canceled = Boolean(event.canceled)
        item.errorText = event.errorText || ''
      }
    })
    client.on('Network.loadingFinished', (event) => {
      const item = askRequests.get(event.requestId)
      if (item) {
        item.finished = true
      }
    })

    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          const originalFetch = window.fetch.bind(window);
          window.__abortTest = {
            cancelResponses: [],
            createdIds: [],
            frontendAbortCount: 0
          };
          window.fetch = async (input, init = {}) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.includes('/api/conversations/') && url.includes('/ask')) {
              init.signal?.addEventListener('abort', () => {
                window.__abortTest.frontendAbortCount += 1;
              }, { once: true });
            }
            const response = await originalFetch(input, init);
            if (url.endsWith('/api/conversations') && (init.method || 'GET').toUpperCase() === 'POST') {
              response.clone().json().then((data) => {
                if (data?.conversation?.id) window.__abortTest.createdIds.push(data.conversation.id);
              }).catch(() => {});
            }
            if (url.includes('/api/requests/') && url.endsWith('/cancel')) {
              const body = await response.clone().json().catch(() => null);
              window.__abortTest.cancelResponses.push({
                url,
                status: response.status,
                body
              });
            }
            return response;
          };
        })();
      `,
    })

    await client.send('Page.navigate', { url: APP_URL })
    await waitFor(client, `Boolean(document.querySelector('textarea'))`)

    const tc01Id = await newChat(client)
    await ask(client, '[TC01] 请持续输出很多短句，用于测试流式过程中点击停止是否会中断上游请求。')
    await waitStop(client)
    await waitUntil(
      () => mock.records.some((item) => item.marker === '[TC01]' && item.stream && item.stage === 'answer'),
      8000,
      'TC01 stream request start',
    )
    await waitAssistantStreamingText(client)
    screenshots.push(await screenshot(client, '01-tc01-streaming-before-stop'))
    const tc01CancelIndex = await evaluate(client, `window.__abortTest.cancelResponses.length`)
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    await waitIdle(client)
    await delay(700)
    const tc01Records = mock.records.filter((item) => item.marker === '[TC01]')
    const tc01Stream = tc01Records.find((item) => item.stream && item.stage === 'answer')
    const tc01StoredMessages = await getConversationMessages(tc01Id)
    const tc01Messages = tc01StoredMessages?.length ?? null
    const tc01Stopped = tc01StoredMessages?.[1]
    const tc01CancelResponse = await evaluate(
      client,
      `window.__abortTest.cancelResponses[${tc01CancelIndex}] ?? null`,
    )
    await client.send('Page.reload', { ignoreCache: true })
    await waitFor(client, `Boolean(document.querySelector('textarea'))`)
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    const tc01ReloadedDiagnostics = await evaluate(
      client,
      `Boolean(document.querySelector('.generation-details'))`,
    )
    const tc01NetworkRequest = [...askRequests.values()].find((item) =>
      item.url.includes(`/api/conversations/${encodeURIComponent(tc01Id)}/ask`)
    )
    const tc01NetworkTerminated = Boolean(
      tc01NetworkRequest?.failed || tc01NetworkRequest?.finished
    )
    const tc01CancelCompleted = Boolean(
      tc01CancelResponse?.status === 200 &&
      tc01CancelResponse?.body?.cancelled === true &&
      tc01CancelResponse?.body?.completed === true
    )
    results.push({
      id: 'TC-01',
      name: '流式回复中停止',
      pass: Boolean(
        tc01Stream?.closeBeforeEnd &&
        tc01NetworkTerminated &&
        tc01CancelCompleted &&
        tc01Messages === 2 &&
        tc01Stopped?.status === 'stopped' &&
        tc01Stopped?.generation?.provider === 'deepseek' &&
        tc01ReloadedDiagnostics
      ),
      upstreamCloseBeforeEnd: Boolean(tc01Stream?.closeBeforeEnd),
      chunksBeforeAbort: tc01Stream?.chunksSent ?? 0,
      networkRequest: tc01NetworkRequest,
      networkRequestTerminated: tc01NetworkTerminated,
      cancelCompleted: tc01CancelCompleted,
      persistedMessageCount: tc01Messages,
      persistedStatus: tc01Stopped?.status,
      diagnosticsAfterReload: tc01ReloadedDiagnostics,
    })
    await showOverlay(client, 'TC-01 流式回复中停止', [
      `PASS: ${results.at(-1).pass}`,
      `upstream close before end: ${Boolean(tc01Stream?.closeBeforeEnd)}`,
      `chunks before abort: ${tc01Stream?.chunksSent ?? 0}`,
      `CDP /ask terminal: ${tc01NetworkTerminated}`,
      `cancel completed: ${tc01CancelCompleted}`,
      `persisted messages: ${tc01Messages}`,
      `persisted status: ${tc01Stopped?.status}`,
      `diagnostics after reload: ${tc01ReloadedDiagnostics}`,
    ])
    screenshots.push(await screenshot(client, '02-tc01-stopped-upstream-aborted'))

    const tc02Id = await newChat(client)
    await ask(client, '[TC02] 首 token 前停止：请在函数调用判断阶段保持慢响应。')
    await waitStop(client)
    await delay(250)
    screenshots.push(await screenshot(client, '03-tc02-before-first-token-stop-ready'))
    const tc02CancelIndex = await evaluate(client, `window.__abortTest.cancelResponses.length`)
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    await waitIdle(client)
    await delay(700)
    const tc02Records = mock.records.filter((item) => item.marker === '[TC02]')
    const tc02ToolDecision = tc02Records.find((item) => item.stream && item.stage === 'tool-decision')
    const tc02AnswerStarted = tc02Records.some((item) => item.stream && item.stage === 'answer')
    const tc02Messages = await getMessageCounts(tc02Id)
    const tc02CancelCompleted = await evaluate(
      client,
      `(() => {
        const response = window.__abortTest.cancelResponses[${tc02CancelIndex}];
        return response?.status === 200 && response.body?.cancelled === true && response.body?.completed === true;
      })()`,
    )
    results.push({
      id: 'TC-02',
      name: '首 token 前停止',
      pass: Boolean(
        tc02ToolDecision?.closeBeforeEnd &&
        !tc02AnswerStarted &&
        tc02Messages === 0 &&
        tc02CancelCompleted
      ),
      upstreamToolDecisionClosedBeforeEnd: Boolean(tc02ToolDecision?.closeBeforeEnd),
      answerStreamRequestStarted: tc02AnswerStarted,
      persistedMessageCount: tc02Messages,
      cancelCompleted: tc02CancelCompleted,
    })
    await showOverlay(client, 'TC-02 首 token 前停止', [
      `PASS: ${results.at(-1).pass}`,
      `tool-decision upstream close before end: ${Boolean(tc02ToolDecision?.closeBeforeEnd)}`,
      `answer stream request started: ${tc02AnswerStarted}`,
      `persisted messages: ${tc02Messages}`,
      `cancel completed: ${tc02CancelCompleted}`,
    ])
    screenshots.push(await screenshot(client, '04-tc02-stopped-before-first-token'))

    const tc04Id = await newChat(client)
    await ask(client, '[TC04] 正在生成时点击新建聊天，验证旧请求会先中断。')
    await waitStop(client)
    await waitUntil(
      () => mock.records.some((item) => item.marker === '[TC04]' && item.stream && item.stage === 'answer'),
      8000,
      'TC04 stream request start',
    )
    screenshots.push(await screenshot(client, '05-tc04-generating-before-new-chat'))
    const tc04CancelIndex = await evaluate(client, `window.__abortTest.cancelResponses.length`)
    await clickText(client, 'button', '新建')
    await waitFor(client, `Boolean(document.querySelector('.empty-state') && document.querySelector('textarea'))`)
    await delay(700)
    const tc04Records = mock.records.filter((item) => item.marker === '[TC04]')
    const tc04ClosedRecord = tc04Records.find((item) => item.stage === 'answer' && item.closeBeforeEnd)
    const tc04Messages = await getMessageCounts(tc04Id)
    const activeEmpty = await evaluate(client, `Boolean(document.querySelector('.empty-state'))`)
    const tc04CancelCompleted = await evaluate(
      client,
      `(() => {
        const response = window.__abortTest.cancelResponses[${tc04CancelIndex}];
        return response?.status === 200 && response.body?.cancelled === true && response.body?.completed === true;
      })()`,
    )
    results.push({
      id: 'TC-04',
      name: '新建聊天时自动中断',
      pass: Boolean(
        tc04ClosedRecord && tc04Messages === 0 && activeEmpty && tc04CancelCompleted
      ),
      upstreamCloseBeforeEnd: Boolean(tc04ClosedRecord),
      canceledStage: tc04ClosedRecord?.stream ? 'stream' : 'function-call',
      persistedOldConversationMessages: tc04Messages,
      activeConversationEmpty: activeEmpty,
      cancelCompleted: tc04CancelCompleted,
    })
    await showOverlay(client, 'TC-04 新建聊天时自动中断', [
      `PASS: ${results.at(-1).pass}`,
      `old upstream close before end: ${Boolean(tc04ClosedRecord)}`,
      `canceled stage: ${tc04ClosedRecord?.stream ? 'stream' : 'function-call'}`,
      `old persisted messages: ${tc04Messages}`,
      `new chat empty: ${activeEmpty}`,
      `cancel completed: ${tc04CancelCompleted}`,
    ])
    screenshots.push(await screenshot(client, '06-tc04-new-chat-aborted-upstream'))

    const tc08Id = await newChat(client)
    await ask(client, '[TC08] 上游慢响应中断：流式请求建立后先不要返回 token。')
    await waitStop(client)
    await waitUntil(
      () => mock.records.some((item) => item.marker === '[TC08]' && item.stream && item.stage === 'answer'),
      8000,
      'TC08 stream request start',
    )
    screenshots.push(await screenshot(client, '07-tc08-slow-upstream-before-stop'))
    const tc08CancelIndex = await evaluate(client, `window.__abortTest.cancelResponses.length`)
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    await waitIdle(client)
    await delay(700)
    const tc08Stream = mock.records
      .filter((item) => item.marker === '[TC08]')
      .find((item) => item.stream && item.stage === 'answer')
    const tc08Messages = await getMessageCounts(tc08Id)
    const tc08CancelCompleted = await evaluate(
      client,
      `(() => {
        const response = window.__abortTest.cancelResponses[${tc08CancelIndex}];
        return response?.status === 200 && response.body?.cancelled === true && response.body?.completed === true;
      })()`,
    )
    results.push({
      id: 'TC-08',
      name: '上游慢响应中断',
      pass: Boolean(
        tc08Stream?.closeBeforeEnd &&
        tc08Stream?.chunksSent === 0 &&
        tc08Messages === 0 &&
        tc08CancelCompleted
      ),
      upstreamCloseBeforeEnd: Boolean(tc08Stream?.closeBeforeEnd),
      chunksBeforeAbort: tc08Stream?.chunksSent ?? 0,
      persistedMessageCount: tc08Messages,
      cancelCompleted: tc08CancelCompleted,
    })
    await showOverlay(client, 'TC-08 上游慢响应中断', [
      `PASS: ${results.at(-1).pass}`,
      `stream upstream close before first token: ${Boolean(tc08Stream?.closeBeforeEnd)}`,
      `chunks before abort: ${tc08Stream?.chunksSent ?? 0}`,
      `persisted messages: ${tc08Messages}`,
      `cancel completed: ${tc08CancelCompleted}`,
    ])
    screenshots.push(await screenshot(client, '08-tc08-slow-upstream-aborted'))

    const frontendAbortCount = await evaluate(client, `window.__abortTest.frontendAbortCount`)
    const createdIds = await evaluate(client, `window.__abortTest.createdIds`)
    const summary = {
      allPassed: results.every((item) => item.pass),
      frontendAbortCount,
      askRequests: [...askRequests.values()],
      upstreamRecords: mock.records,
      results,
      screenshots,
    }
    await showOverlay(client, 'CDP upstream abort summary', [
      `all passed: ${summary.allPassed}`,
      `frontend abort count: ${frontendAbortCount}`,
      `created conversations: ${createdIds.length}`,
      `upstream close-before-end records: ${mock.records.filter((item) => item.closeBeforeEnd).length}`,
    ])
    screenshots.push(await screenshot(client, '09-summary'))
    summary.screenshots = screenshots
    await writeFile(RESULT_FILE, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

    for (const id of createdIds) {
      await fetch(`${SERVER_URL}/conversations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => {})
    }

    console.log(JSON.stringify(summary, null, 2))
    if (!summary.allPassed) {
      throw new Error('Upstream abort scenarios failed')
    }
  } finally {
    client?.close()
    await stopProcess(chrome)
    await stopProcess(vite)
    await stopProcess(server)
    await mock.stop()
    await rm(profileDir, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
    await rm(VITE_TEST_CONFIG, { force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
