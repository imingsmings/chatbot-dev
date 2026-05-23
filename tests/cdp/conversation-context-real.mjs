import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const API_BASE = new URL('/api', APP_URL).toString().replace(/\/$/, '')
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9335)
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-conversation-screenshots')
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const REAL_WAIT_TIMEOUT_MS = readPositiveInteger(
  'CDP_REAL_CONTEXT_WAIT_TIMEOUT_MS',
  readPositiveInteger('CDP_REAL_WAIT_TIMEOUT_MS', 180000),
)
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const TITLE_PREFIX = `CDPCTX-${STAMP}`
const TITLE_A = `${TITLE_PREFIX}-A`
const TITLE_A_RENAMED = `${TITLE_PREFIX}-A-RENAMED`
const TITLE_B = `${TITLE_PREFIX}-B`
const SECRET_A = `橙色河流-${STAMP}`
const SECRET_B = `蓝色山谷-${STAMP}`

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

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
        for (const listener of listeners) listener(payload.params || {})
      }
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

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
  }

  return result.result?.value
}

async function waitFor(client, expression, timeoutMs = REAL_WAIT_TIMEOUT_MS) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const value = await evaluate(client, expression)
    if (value) return value
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

async function cleanupTestConversations() {
  const response = await fetch(`${API_BASE}/conversations`)
  if (!response.ok) return

  const data = await response.json()
  const conversations = Array.isArray(data.conversations) ? data.conversations : []
  await Promise.all(
    conversations
      .filter((conversation) => String(conversation.title || '').startsWith('CDPCTX-'))
      .map((conversation) =>
        fetch(`${API_BASE}/conversations/${encodeURIComponent(conversation.id)}`, {
          method: 'DELETE',
        }).catch(() => null),
      ),
  )
}

async function clickText(client, selector, text) {
  await evaluate(
    client,
    `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((node) => node.textContent.trim() === ${JSON.stringify(text)});
      if (!el) throw new Error('Cannot find text: ${text}');
      el.click();
    })()`,
  )
}

async function waitForDialog(client, title) {
  await waitFor(
    client,
    `document.querySelector('.modal-content[role="dialog"]')?.innerText.includes(${JSON.stringify(title)})`,
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

async function confirmDialog(client, label = '确定') {
  await clickDialogButton(client, label)
  await waitFor(client, `!document.querySelector('.modal-content[role="dialog"]')`)
}

async function submitPromptDialog(client, value) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('.modal-content[role="dialog"] .dialog-input');
      if (!input) throw new Error('Cannot find dialog input');
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  )
  await confirmDialog(client, '保存')
}

async function clickConversationTitle(client, title) {
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('.conversation-item')]
        .find((node) => node.querySelector('.conversation-title')?.textContent.trim() === ${JSON.stringify(title)});
      if (!button) throw new Error('Cannot find conversation: ${title}');
      button.click();
    })()`,
  )
}

async function renameActiveConversation(client, title) {
  await evaluate(
    client,
    `(() => {
      const button = document.querySelector('.conversation-item-shell.active .conversation-action-btn[title="重命名"]');
      if (!button) throw new Error('Cannot find active rename button');
      button.click();
    })()`,
  )
  await waitForDialog(client, '重命名会话')
  await submitPromptDialog(client, title)
  await waitFor(
    client,
    `[...document.querySelectorAll('.conversation-title')].some((node) => node.textContent.trim() === ${JSON.stringify(title)})`,
  )
  await clickConversationTitle(client, title)
  await waitFor(
    client,
    `document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim() === ${JSON.stringify(title)}`,
  )
}

async function confirmActiveDelete(client) {
  await evaluate(
    client,
    `(() => {
      const button = document.querySelector('.conversation-item-shell.active .conversation-action-btn[title="删除"]');
      if (!button) throw new Error('Cannot find active delete button');
      button.click();
    })()`,
  )
  await waitForDialog(client, '删除会话')
  await confirmDialog(client, '删除')
}

async function clearCurrentConversation(client) {
  await clickText(client, 'button', '清空当前会话')
  await waitForDialog(client, '清空当前会话')
  await confirmDialog(client, '清空')
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

async function waitIdle(client) {
  await waitFor(
    client,
    `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送') &&
      ![...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`,
  )
}

async function askAndWait(client, question, expectedText) {
  await ask(client, question)
  await waitFor(client, `document.body.innerText.includes(${JSON.stringify(expectedText)})`)
  await waitIdle(client)
}

async function createAndRenameConversation(client, title) {
  await clickText(client, 'button', '新建')
  await waitFor(client, `document.querySelector('.empty-state')`)
  await renameActiveConversation(client, title)
}

const observeScript = `
(() => {
  const originalFetch = window.fetch.bind(window);
  window.__conversationFetchLog = [];
  window.__conversationAskCount = 0;

  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';
    if (url.includes('/api/conversations')) {
      window.__conversationFetchLog.push({ method, url });
      if (/\\/api\\/conversations\\/[^/]+\\/ask/.test(url)) {
        window.__conversationAskCount += 1;
      }
    }
    return originalFetch(input, init);
  };
})();
`

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  await cleanupTestConversations()

  const profileDir = await mkdtemp(path.join(tmpdir(), 'chatbot-conversation-cdp-'))
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
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: observeScript })
    await client.send('Page.navigate', { url: APP_URL })
    await waitFor(client, `document.querySelector('textarea') && document.querySelector('.conversation-item-shell')`)
    await screenshot(client, '01-initial-conversation-list')

    await createAndRenameConversation(client, TITLE_A)
    await screenshot(client, '02-created-conversation-a')

    await askAndWait(
      client,
      `请记住当前会话暗号：${SECRET_A}。只回复“已记住${SECRET_A}”。`,
      SECRET_A,
    )
    await askAndWait(client, '上一条暗号是什么？只输出暗号，不要解释。', SECRET_A)
    await screenshot(client, '03-conversation-a-two-turn-context')

    await createAndRenameConversation(client, TITLE_B)
    await askAndWait(
      client,
      `请记住当前会话暗号：${SECRET_B}。只回复“已记住${SECRET_B}”。`,
      SECRET_B,
    )
    await askAndWait(client, '上一条暗号是什么？只输出暗号，不要解释。', SECRET_B)
    await screenshot(client, '04-conversation-b-context')

    await clickConversationTitle(client, TITLE_A)
    await waitFor(client, `document.body.innerText.includes(${JSON.stringify(SECRET_A)})`)
    await screenshot(client, '05-switch-back-a-history-restored')

    await askAndWait(client, '请再次回答当前会话暗号，只输出暗号，不要提其他暗号。', SECRET_A)
    const isolationState = await evaluate(
      client,
      `(() => {
        const text = document.querySelector('.message-list')?.innerText || '';
        return {
          containsA: text.includes(${JSON.stringify(SECRET_A)}),
          containsB: text.includes(${JSON.stringify(SECRET_B)}),
          text,
        };
      })()`,
    )
    await screenshot(client, '06-context-isolation-a-only')

    await renameActiveConversation(client, TITLE_A_RENAMED)
    await screenshot(client, '07-renamed-conversation-a')

    await client.send('Page.reload', { ignoreCache: true })
    await waitFor(client, `document.body.innerText.includes(${JSON.stringify(TITLE_A_RENAMED)})`)
    await clickConversationTitle(client, TITLE_A_RENAMED)
    await waitFor(client, `document.body.innerText.includes(${JSON.stringify(SECRET_A)})`)
    await screenshot(client, '08-refresh-persistence')

    await clearCurrentConversation(client)
    await waitFor(
      client,
      `document.querySelector('.empty-state') &&
        document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim() === ${JSON.stringify(TITLE_A_RENAMED)} &&
        document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.includes('0 条消息')`,
    )
    await screenshot(client, '09-clear-current-conversation')

    await clickConversationTitle(client, TITLE_B)
    await waitFor(client, `document.body.innerText.includes(${JSON.stringify(SECRET_B)})`)
    await screenshot(client, '10-other-conversation-unchanged-after-clear')

    await confirmActiveDelete(client)
    await waitFor(
      client,
      `![...document.querySelectorAll('.conversation-title')].some((node) => node.textContent.trim() === ${JSON.stringify(TITLE_B)})`,
    )
    await screenshot(client, '11-delete-conversation-b')

    const finalState = await evaluate(
      client,
      `(() => ({
        askCount: window.__conversationAskCount,
        requestLog: window.__conversationFetchLog,
        titles: [...document.querySelectorAll('.conversation-title')].map((node) => node.textContent.trim()),
        activeTitle: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
        activeMeta: document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.trim(),
      }))()`,
    )

    console.log(JSON.stringify({
      stamp: STAMP,
      titleA: TITLE_A,
      titleARenamed: TITLE_A_RENAMED,
      titleB: TITLE_B,
      secretA: SECRET_A,
      secretB: SECRET_B,
      isolationState: {
        containsA: isolationState.containsA,
        containsB: isolationState.containsB,
      },
      finalState,
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
