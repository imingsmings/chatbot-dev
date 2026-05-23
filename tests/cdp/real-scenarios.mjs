import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const API_URL = new URL('/api', APP_URL).toString().replace(/\/$/, '')
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9334)
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-real-screenshots')
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const REAL_WAIT_TIMEOUT_MS = readPositiveInteger('CDP_REAL_WAIT_TIMEOUT_MS', 120000)

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}
const CDP_COMMAND_TIMEOUT_MS = 10000

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()

    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })

    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data)
      if (!payload.id) return

      const request = this.pending.get(payload.id)
      if (!request) return
      this.pending.delete(payload.id)

      if (payload.error) {
        request.reject(new Error(`${payload.error.message}: ${payload.error.data || ''}`))
      } else {
        request.resolve(payload.result || {})
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
        reject(new Error(`CDP command timed out: ${method}`))
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

async function cleanupTestConversations() {
  const response = await fetch(`${API_URL}/conversations`).catch(() => null)
  if (!response?.ok) return

  const data = await response.json()
  const conversations = Array.isArray(data.conversations) ? data.conversations : []
  await Promise.all(
    conversations
      .filter((conversation) => String(conversation.title || '').startsWith('真实接口测试'))
      .map((conversation) =>
        fetch(`${API_URL}/conversations/${encodeURIComponent(conversation.id)}`, {
          method: 'DELETE',
        }).catch(() => null),
      ),
  )
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

async function waitFor(client, expression, timeoutMs = REAL_WAIT_TIMEOUT_MS) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const result = await evaluate(client, expression)
    if (result) return result
    await delay(150)
  }

  throw new Error(`Timed out waiting for expression: ${expression}`)
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

async function newChat(client) {
  await clickText(client, 'button', '新建')
  await waitFor(client, `document.querySelector('.empty-state') && document.querySelector('textarea')`)
}

const observeScript = `
(() => {
  const originalFetch = window.fetch.bind(window);
  window.__realAskCount = 0;
  window.__realAbortCount = 0;

  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/\\/api\\/conversations\\/[^/]+\\/ask$/.test(new URL(url, location.origin).pathname)) {
      window.__realAskCount += 1;
      init.signal?.addEventListener('abort', () => {
        window.__realAbortCount += 1;
      }, { once: true });
    }
    return originalFetch(input, init);
  };
})();
`

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  await cleanupTestConversations()

  const profileDir = await mkdtemp(path.join(tmpdir(), 'chatbot-real-cdp-'))
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
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP_URL)}`, {
      method: 'PUT',
    })

    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
    const target =
      targets.find((item) => item.type === 'page' && item.url.startsWith(APP_URL)) ||
      targets.find((item) => item.type === 'page')
    const client = new CdpClient(target.webSocketDebuggerUrl)

    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Browser.grantPermissions', {
      origin: APP_URL,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    }).catch(() => {})
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: observeScript })
    await client.send('Page.navigate', { url: APP_URL })
    await waitFor(client, `document.querySelector('textarea')`)

    await ask(client, '真实接口测试一：请用中文写一段较长说明，分多句输出，方便测试停止生成按钮。')
    await waitStop(client)
    await screenshot(client, '01-real-generating-stop-button')
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成') || document.body.innerText.includes('响应中断')`)
    await waitIdle(client)
    await screenshot(client, '01-real-stopped-after-click')

    await newChat(client)
    await ask(client, '真实接口测试二：请只回复一句话：真实接口复制测试通过。')
    await waitFor(
      client,
      `[...document.querySelectorAll('.message-row.assistant')]
        .some((row) => row.innerText.trim().length > 0)`,
    )
    await waitIdle(client)
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
    await screenshot(client, '02-real-copy-shows-copied')

    await newChat(client)
    await ask(client, '真实接口测试三：请写一段至少 500 字的中文内容，方便我中断后继续发送。')
    await waitStop(client)
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成') || document.body.innerText.includes('响应中断')`)
    await waitIdle(client)
    const stoppedState = await evaluate(
      client,
      `(() => ({
        userRows: [...document.querySelectorAll('.message-row.user')].length,
        assistantRows: [...document.querySelectorAll('.message-row.assistant')].length,
        hasRetry: [...document.querySelectorAll('button')].some((node) => node.textContent.trim() === '重试'),
        hasStoppedText: document.body.innerText.includes('已停止生成'),
        partialTextLength: document.querySelector('.message-row.assistant')?.innerText.trim().length || 0,
        askCount: window.__realAskCount,
        abortCount: window.__realAbortCount,
      }))()`,
    )
    if (stoppedState.hasRetry || !stoppedState.hasStoppedText) {
      throw new Error(`Stopped message state failed: ${JSON.stringify(stoppedState)}`)
    }
    await screenshot(client, '03-real-stopped-no-retry')
    await ask(client, '真实接口测试三续：请只回复一句话：停止后继续发送成功。')
    await waitFor(client, `document.querySelectorAll('.message-row.assistant').length >= 2`)
    await waitIdle(client)
    const retryState = await evaluate(
      client,
      `(() => ({
        userRows: [...document.querySelectorAll('.message-row.user')].length,
        assistantRows: [...document.querySelectorAll('.message-row.assistant')].length,
        askCount: window.__realAskCount,
        abortCount: window.__realAbortCount,
        text: document.querySelector('.message-list')?.innerText,
      }))()`,
    )
    await screenshot(client, '03-real-continue-after-stop')

    await newChat(client)
    await ask(client, '真实接口测试四：请输出 80 条很短的编号句子，每条一句，用于制造可滚动的聊天历史。')
    await waitIdle(client)
    await evaluate(
      client,
      `(() => {
        const scroll = document.querySelector('.chat-scroll');
        let fixture = document.querySelector('#real-scroll-fixture');
        if (!fixture) {
          fixture = document.createElement('div');
          fixture.id = 'real-scroll-fixture';
          fixture.setAttribute('aria-hidden', 'true');
          scroll.appendChild(fixture);
        }
        fixture.style.cssText = 'height:900px;min-height:900px;pointer-events:none;';
        return scroll.scrollHeight > scroll.clientHeight + 300;
      })()`,
    )
    await evaluate(client, `document.querySelector('.chat-scroll').scrollTop = 120`)
    const scrollBefore = await evaluate(client, `Math.round(document.querySelector('.chat-scroll').scrollTop)`)
    await ask(client, '真实接口测试四续：请继续输出 60 条编号短句，测试我停在历史位置时不会被拉到底。')
    await waitStop(client)
    await delay(2500)
    const scrollDuring = await evaluate(client, `Math.round(document.querySelector('.chat-scroll').scrollTop)`)
    const bottomGap = await evaluate(
      client,
      `(() => {
        const el = document.querySelector('.chat-scroll');
        return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
      })()`,
    )
    await screenshot(client, '04-real-scroll-does-not-force-bottom')
    await clickText(client, 'button', '停止').catch(() => {})
    await waitIdle(client).catch(() => {})
    await evaluate(client, `document.querySelector('#real-scroll-fixture')?.remove()`)

    await newChat(client)
    await ask(client, '真实接口测试五：请写一段至少 800 字内容，我会在生成中点击新建聊天。')
    await waitStop(client)
    await clickText(client, 'button', '新建')
    await waitFor(client, `document.querySelector('.empty-state') && document.querySelector('textarea')`)
    const newChatAbortCount = await waitFor(client, `window.__realAbortCount > 0 && window.__realAbortCount`)
    await screenshot(client, '05-real-new-chat-aborts-generation')

    console.log(JSON.stringify({
      retryState,
      scrollBefore,
      scrollDuring,
      bottomGap,
      newChatAbortCount,
      realAskCount: await evaluate(client, `window.__realAskCount`),
      realAbortCount: await evaluate(client, `window.__realAbortCount`),
    }, null, 2))

    client.close()
  } finally {
    chrome.kill('SIGTERM')
    await cleanupTestConversations()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
