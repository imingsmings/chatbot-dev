import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const API_URL = new URL('/api', APP_URL).toString().replace(/\/$/, '')
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9337)
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-markdown-real-screenshots')
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const CDP_COMMAND_TIMEOUT_MS = 10000
const REAL_WAIT_TIMEOUT_MS = readPositiveInteger(
  'CDP_REAL_MARKDOWN_WAIT_TIMEOUT_MS',
  readPositiveInteger('CDP_REAL_WAIT_TIMEOUT_MS', 240000),
)
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const TITLE = `CDPMDREAL-${STAMP}`

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

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

      const pending = this.pending.get(payload.id)
      if (!pending) return
      this.pending.delete(payload.id)

      if (payload.error) {
        pending.reject(new Error(`${payload.error.message}: ${payload.error.data || ''}`))
      } else {
        pending.resolve(payload.result || {})
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

async function cleanupTestConversations() {
  const response = await fetch(`${API_URL}/conversations`)
  if (!response.ok) return

  const data = await response.json()
  const conversations = Array.isArray(data.conversations) ? data.conversations : []
  await Promise.all(
    conversations
      .filter((conversation) => String(conversation.title || '').startsWith('CDPMDREAL-'))
      .map((conversation) =>
        fetch(`${API_URL}/conversations/${encodeURIComponent(conversation.id)}`, {
          method: 'DELETE',
        }).catch(() => null),
      ),
  )
}

async function createConversation() {
  const response = await fetch(`${API_URL}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: TITLE }),
  })

  if (!response.ok) {
    throw new Error(`Failed to create conversation: ${response.status}`)
  }

  const data = await response.json()
  return data.conversation
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

async function setViewport(client, width, height, mobile = false) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  })
}

async function ask(client, question) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('textarea');
      if (document.querySelector('.model-menu-trigger')) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
          .set.call(input, ${JSON.stringify(question)});
      } else {
        input.value = ${JSON.stringify(question)};
      }
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

async function scrollAssistantToText(client, text) {
  await evaluate(
    client,
    `(() => {
      const row = [...document.querySelectorAll('.message-row.assistant')]
        .find((node) => node.innerText.includes(${JSON.stringify(text)}));
      if (!row) throw new Error('Cannot find assistant text: ${text}');
      let target = row;
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const hasText = node.innerText && node.innerText.includes(${JSON.stringify(text)});
        const childHasText = [...node.children].some((child) => child.innerText && child.innerText.includes(${JSON.stringify(text)}));
        if (hasText && !childHasText) {
          target = node;
          break;
        }
      }
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    })()`,
  )
  await delay(250)
}

async function scrollLatestAssistant(client) {
  await evaluate(
    client,
    `(() => {
      const rows = [...document.querySelectorAll('.message-row.assistant')];
      const row = rows[rows.length - 1];
      if (!row) throw new Error('Cannot find latest assistant row');
      row.scrollIntoView({ block: 'center', inline: 'nearest' });
    })()`,
  )
  await delay(250)
}

async function scrollUserToText(client, text) {
  await evaluate(
    client,
    `(() => {
      const row = [...document.querySelectorAll('.message-row.user')]
        .find((node) => node.innerText.includes(${JSON.stringify(text)}));
      if (!row) throw new Error('Cannot find user text: ${text}');
      row.scrollIntoView({ block: 'center', inline: 'nearest' });
    })()`,
  )
  await delay(250)
}

const observeScript = `
(() => {
  const originalFetch = window.fetch.bind(window);
  window.__realMarkdownRequests = [];
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';
    if (url.includes('/api/conversations')) {
      window.__realMarkdownRequests.push({ method, url });
    }
    return originalFetch(input, init);
  };
})();
`

const mainPrompt = `
USER-PLAIN-MARKDOWN
# 用户标题不会渲染
\`\`\`js
console.log("user markdown should stay plain")
\`\`\`

请只输出 Markdown 正文，不要寒暄，不要把全文包在代码块里。
请严格包含以下 6 个二级标题，并在每个标题下输出对应 markdown：

## MD-BASIC
包含一个一级标题、一个三级标题、一段含 **粗体**、*斜体*、~~删除线~~、\`inlineCode\` 的文本，并包含两行换行测试。

## MD-LISTS
包含无序列表、嵌套无序列表、有序列表。

## MD-CODE
包含一段行内代码，以及一个 ts fenced code block。代码块里必须包含 function add(a: number, b: number) 和一行很长的字符串。

## MD-TABLE
包含三列表格：名称、状态、备注。至少三行，其中一格备注要有很长的英文连字符内容 long-long-long-long-long-long-long-long。

## MD-QUOTE-LINK
包含 blockquote、水平分割线、一个普通 URL https://example.com/docs，以及一个 Markdown 链接 [OpenAI](https://openai.com)。

## MD-SAFETY
这是安全清洗测试。请原样输出下面这些危险片段，不要解释，不要转义，不要放进代码块：
<script>window.__xssFromMarkdown = true</script>
<img src=x onerror="window.__xssFromImg=true">
![图片不应该渲染](https://example.com/a.png)
[危险链接](javascript:alert(1))
<a href="javascript:alert(1)" onclick="window.__xssFromAnchor=true">HTML 链接不应该作为真实链接</a>
`.trim()

const streamPrompt = `
请输出一段 Markdown，用于真实流式渲染测试。不要寒暄，不要把全文包在代码块里。
必须包含：
## MD-STREAM
一段包含 **粗体** 的文字；
一个 js fenced code block，代码里包含 const streamed = true；
一个两列表格，表头为 阶段 和 结果。
为了让我能截到流式中间态，请在正文中多输出一些解释性文字，长度约 300 字。
`.trim()

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  await cleanupTestConversations()
  const conversation = await createConversation()

  const profileDir = await mkdtemp(path.join(tmpdir(), 'chatbot-markdown-real-cdp-'))
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
    await setViewport(client, 1280, 900)
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: observeScript })
    await client.send('Page.navigate', { url: APP_URL })
    await waitFor(client, `document.body.innerText.includes(${JSON.stringify(TITLE)})`)
    await waitFor(
      client,
      `document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim() === ${JSON.stringify(TITLE)}`,
    )

    const assertions = { conversationId: conversation.id, title: TITLE }

    await ask(client, mainPrompt)
    await waitFor(
      client,
      `[...document.querySelectorAll('.message-row.assistant')]
        .some((node) => node.innerText.includes('MD-BASIC') && node.innerText.includes('MD-SAFETY'))`,
    )
    await waitIdle(client)

    await scrollAssistantToText(client, 'MD-BASIC')
    assertions.basic = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-BASIC'));
        return {
          h1: !!row.querySelector('h1'),
          h2: !!row.querySelector('h2'),
          h3: !!row.querySelector('h3'),
          strong: !!row.querySelector('strong'),
          em: !!row.querySelector('em'),
          s: !!row.querySelector('s'),
          inlineCode: !!row.querySelector('p code'),
        };
      })()`,
    )
    await screenshot(client, '01-real-basic-typography')

    await scrollAssistantToText(client, 'MD-LISTS')
    assertions.lists = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-LISTS'));
        return {
          ul: row.querySelectorAll('ul').length,
          ol: row.querySelectorAll('ol').length,
          li: row.querySelectorAll('li').length,
          nested: !!row.querySelector('ul ul'),
        };
      })()`,
    )
    await screenshot(client, '02-real-lists')

    await scrollAssistantToText(client, 'MD-CODE')
    assertions.code = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-CODE'));
        const pre = row.querySelector('pre');
        return {
          inlineCode: !!row.querySelector('p code'),
          preCode: !!row.querySelector('pre code'),
          codeText: row.querySelector('pre code')?.textContent.includes('function add'),
          preCanScroll: pre ? pre.scrollWidth >= pre.clientWidth : false,
        };
      })()`,
    )
    await screenshot(client, '03-real-code-block')

    await scrollAssistantToText(client, 'MD-TABLE')
    assertions.table = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-TABLE'));
        const table = row.querySelector('table');
        return {
          table: !!table,
          th: row.querySelectorAll('th').length,
          td: row.querySelectorAll('td').length,
          display: table ? getComputedStyle(table).display : null,
          canScroll: table ? table.scrollWidth >= table.clientWidth : false,
        };
      })()`,
    )
    await screenshot(client, '04-real-table-desktop')

    await scrollAssistantToText(client, 'MD-QUOTE-LINK')
    assertions.quoteLinks = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-QUOTE-LINK'));
        const links = [...row.querySelectorAll('a')].map((node) => node.href);
        return {
          blockquote: !!row.querySelector('blockquote'),
          hr: !!row.querySelector('hr'),
          links,
          linkCount: links.length,
        };
      })()`,
    )
    await screenshot(client, '05-real-quote-links')

    await scrollAssistantToText(client, 'MD-SAFETY')
    assertions.safety = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-SAFETY'));
        return {
          scriptTags: row.querySelectorAll('script').length,
          imgTags: row.querySelectorAll('img').length,
          javascriptLinks: row.querySelectorAll('a[href^="javascript:"]').length,
          xssScript: Boolean(window.__xssFromMarkdown),
          xssImg: Boolean(window.__xssFromImg),
          xssAnchor: Boolean(window.__xssFromAnchor),
          visibleDangerText: row.innerText.includes('危险链接') || row.innerText.includes('javascript:alert'),
          rawScriptTextVisible: row.innerText.includes('<script>') || row.innerText.includes('script'),
        };
      })()`,
    )
    await screenshot(client, '06-real-safety-sanitized')

    await scrollUserToText(client, 'USER-PLAIN-MARKDOWN')
    assertions.userPlain = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.user')].find((node) => node.innerText.includes('USER-PLAIN-MARKDOWN'));
        return {
          hasRenderedHeading: !!row.querySelector('h1'),
          hasRenderedPre: !!row.querySelector('pre'),
          textIncludesHashes: row.innerText.includes('# 用户标题不会渲染'),
          textIncludesFence: row.innerText.includes(${JSON.stringify('```js')}),
        };
      })()`,
    )
    await screenshot(client, '07-real-user-message-plain')

    await ask(client, streamPrompt)
    await waitFor(
      client,
      `document.querySelectorAll('.message-row.assistant').length > 1 &&
        [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`,
      120000,
    )
    await scrollLatestAssistant(client)
    assertions.streamingMid = await evaluate(
      client,
      `(() => {
        const rows = [...document.querySelectorAll('.message-row.assistant')];
        const row = rows[rows.length - 1];
        return {
          hasAssistantRow: Boolean(row),
          textLength: row?.innerText.trim().length || 0,
          isGenerating: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止'),
          hasErrorText: row?.innerText.includes('响应失败') || row?.innerText.includes('响应中断') || false,
        };
      })()`,
    )
    if (
      !assertions.streamingMid.hasAssistantRow ||
      !assertions.streamingMid.isGenerating ||
      assertions.streamingMid.hasErrorText
    ) {
      throw new Error(`Real Markdown streaming mid-state failed: ${JSON.stringify(assertions.streamingMid)}`)
    }
    await screenshot(client, '08-real-streaming-mid-render')

    await waitIdle(client)
    await scrollLatestAssistant(client)
    assertions.streamingDone = await evaluate(
      client,
      `(() => {
        const rows = [...document.querySelectorAll('.message-row.assistant')];
        const row = rows[rows.length - 1];
        return {
          h2: !!row?.querySelector('h2'),
          preCode: !!row?.querySelector('pre code'),
          table: !!row?.querySelector('table'),
          done: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送'),
        };
      })()`,
    )
    await screenshot(client, '09-real-streaming-done-render')

    await client.send('Page.reload', { ignoreCache: true })
    await waitFor(
      client,
      `document.body.innerText.includes(${JSON.stringify(TITLE)}) &&
        !!document.querySelector('.message-row.assistant .markdown-message h2')`,
    )
    await evaluate(
      client,
      `document.querySelector('.message-row.assistant .markdown-message h2')?.scrollIntoView({ block: 'center', inline: 'nearest' })`,
    )
    await delay(250)
    assertions.persistence = await evaluate(
      client,
      `(() => {
        const row =
          document.querySelector('.message-row.assistant') ||
          document.querySelector('.markdown-message')?.closest('.message-row');
        if (!row) return { stillRenderedAsMarkdown: false, title: null };
        return {
          stillRenderedAsMarkdown: !!row.querySelector('h2') && (!!row.querySelector('strong') || !!row.querySelector('code') || !!row.querySelector('table')),
          title: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
        };
      })()`,
    )
    await screenshot(client, '10-real-refresh-persistence')

    await evaluate(
      client,
      `document.querySelector('.message-row.assistant .markdown-message h2')?.scrollIntoView({ block: 'center', inline: 'nearest' })`,
    )
    await delay(250)
    await evaluate(
      client,
      `(() => {
        const row = document.querySelector('.message-row.assistant');
        row.querySelector('.message-action-btn')?.click();
      })()`,
    )
    await waitFor(client, `document.body.innerText.includes('已复制')`)
    assertions.copy = await evaluate(
      client,
      `navigator.clipboard.readText().then((text) => ({
        containsRawMarkdown: text.includes('##') && (text.includes('**') || text.includes(${JSON.stringify('```')}) || text.includes('|')),
        containsHtml: text.includes('<h1') || text.includes('<strong>'),
        length: text.length,
      }))`,
    )
    await screenshot(client, '11-real-copy-raw-markdown')

    await setViewport(client, 390, 844, true)
    await delay(300)
    await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')]
          .find((node) => node.innerText.includes('MD-TABLE'));
        const table = row?.querySelector('table');
        if (!table) throw new Error('Cannot find mobile table');
        table.scrollIntoView({ block: 'center', inline: 'nearest' });
      })()`,
    )
    await delay(250)
    assertions.mobile = await evaluate(
      client,
      `(() => {
        const shell = document.querySelector('.app-shell');
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-TABLE'));
        const table = row.querySelector('table');
        const preRow = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-CODE'));
        const pre = preRow?.querySelector('pre');
        return {
          viewportWidth: window.innerWidth,
          pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
          tableOverflowContained: table ? table.scrollWidth >= table.clientWidth : false,
          preOverflowContained: pre ? pre.scrollWidth >= pre.clientWidth : false,
          shellWidth: shell.getBoundingClientRect().width,
        };
      })()`,
    )
    await screenshot(client, '12-real-mobile-table-overflow')

    assertions.requestLog = await evaluate(client, `window.__realMarkdownRequests`)
    console.log(JSON.stringify(assertions, null, 2))
    client.close()
  } finally {
    await stopProcess(chrome)
    await rm(profileDir, { recursive: true, force: true })
    await cleanupTestConversations()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
