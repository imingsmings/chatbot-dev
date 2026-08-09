import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9336)
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-markdown-screenshots')
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
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

async function waitFor(client, expression, timeoutMs = 30000) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const result = await evaluate(client, expression)
    if (result) return result
    await delay(100)
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

async function scrollAssistantToText(client, text) {
  await evaluate(
    client,
    `(() => {
      const row = [...document.querySelectorAll('.message-row.assistant')]
        .find((node) => node.innerText.includes(${JSON.stringify(text)}));
      if (!row) throw new Error('Cannot find assistant text: ${text}');
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

async function waitIdle(client) {
  await waitFor(
    client,
    `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送') &&
      ![...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`,
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

const fixtures = {
  id: 'md-fixture',
  title: 'CDP Markdown Fixture',
  createdAt: '2026-05-18T10:30:00.000Z',
  updatedAt: '2026-05-18T10:30:00.000Z',
  titleManuallyEdited: true,
  messages: [
    {
      role: 'user',
      content:
        'USER-PLAIN-MARKDOWN\n# 用户标题不会渲染\n```js\nconsole.log("user")\n```',
    },
    {
      role: 'assistant',
      content:
        '# MD-BASIC 一级标题\n\n## 二级标题\n\n### 三级标题\n\n这是一段包含 **粗体**、*斜体*、~~删除线~~ 和 `inlineCode` 的文本。\n换行测试第一行\n换行测试第二行',
    },
    {
      role: 'assistant',
      content:
        '## MD-LISTS 列表\n\n- 无序一\n- 无序二\n  - 嵌套 A\n  - 嵌套 B\n\n1. 有序一\n2. 有序二\n3. 有序三',
    },
    {
      role: 'assistant',
      content:
        '## MD-CODE 代码\n\n行内代码：`const total = price * count`\n\n```ts\nfunction add(a: number, b: number) {\n  return a + b\n}\n\nconst veryLongLine = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"\n```',
    },
    {
      role: 'assistant',
      content:
        '## MD-TABLE 表格\n\n| 名称 | 状态 | 备注 |\n| --- | --- | --- |\n| Markdown | 正常 | 支持表格 |\n| 代码块 | 正常 | 长内容要横向滚动 long-long-long-long-long-long-long-long-long-long |\n| 链接 | 正常 | 自动识别 |',
    },
    {
      role: 'assistant',
      content:
        '## MD-QUOTE-LINK 引用和链接\n\n> 这是一段引用，用来确认左侧边框和缩进。\n\n---\n\n普通 URL 自动识别：https://example.com/docs\n\nMarkdown 链接：[OpenAI](https://openai.com)',
    },
    {
      role: 'assistant',
      content:
        '## MD-SAFETY 安全清洗\n\n<script>window.__xssFromMarkdown = true</script>\n\n<img src=x onerror="window.__xssFromImg=true">\n\n![图片不应该渲染](https://example.com/a.png)\n\n[危险链接](javascript:alert(1))\n\n<a href="javascript:alert(1)" onclick="window.__xssFromAnchor=true">HTML 链接不应该作为真实链接</a>',
    },
  ],
}

const injectedFetch = `
(() => {
  const encoder = new TextEncoder();
  const fixture = ${JSON.stringify(fixtures)};
  const conversations = new Map([[fixture.id, fixture]]);
  let streamConversationCreated = false;

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

  function ndjson(event) {
    return encoder.encode(JSON.stringify(event) + '\\n');
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    const pathname = new URL(url, location.origin).pathname.replace(/^\\/api/, '');

    if (pathname === '/conversations' && method === 'GET') {
      return json({ conversations: [...conversations.values()].map(summary) });
    }

    if (pathname === '/conversations' && method === 'POST') {
      const conversation = {
        id: 'md-stream',
        title: 'CDP Markdown Streaming',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        titleManuallyEdited: true,
        messages: [],
      };
      conversations.set(conversation.id, conversation);
      streamConversationCreated = true;
      return json({ conversation }, 201);
    }

    const detailMatch = pathname.match(/^\\/conversations\\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      return conversation ? json({ conversation }) : json({ message: 'not found' }, 404);
    }

    const askMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/ask$/);
    if (askMatch && method === 'POST') {
      const conversation = conversations.get(decodeURIComponent(askMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);

      let body = {};
      try {
        body = JSON.parse(init.body || '{}');
      } catch {}

      const finalMarkdown = [
        '## MD-STREAM 流式标题',
        '',
        '流式 **粗体** 正在逐步渲染。',
        '',
        '~~~js',
        'const streamed = true',
        'console.log(streamed)',
        '~~~',
        '',
        '| 阶段 | 结果 |',
        '| --- | --- |',
        '| streaming | ok |',
      ].join('\\n');
      const chunks = [
        '## MD-STREAM 流式标题\\n\\n流式 **粗',
        '体** 正在逐步渲染。\\n\\n~~~js\\nconst streamed = true\\n',
        'console.log(streamed)\\n~~~\\n\\n| 阶段 | 结果 |\\n| --- | --- |\\n| streaming | ok |',
      ];

      const stream = new ReadableStream({
        start(controller) {
          let index = 0;
          const push = () => {
            if (index < chunks.length) {
              controller.enqueue(ndjson({ type: 'delta', content: chunks[index] }));
              index += 1;
              setTimeout(push, 450);
              return;
            }

            conversation.messages.push(
              { role: 'user', content: body.question || '' },
              { role: 'assistant', content: finalMarkdown },
            );
            conversation.updatedAt = new Date().toISOString();
            controller.enqueue(ndjson({ type: 'done' }));
            controller.close();
          };
          setTimeout(push, 250);
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'X-Chat-Stream-Protocol': '2',
        },
      });
    }

    return json({ message: 'unexpected request', method, pathname }, 500);
  };

  window.__mdFixtureReady = true;
})();
`

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const profileDir = await mkdtemp(path.join(tmpdir(), 'chatbot-markdown-cdp-'))
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
      origin: APP_URL,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    }).catch(() => {})
    await setViewport(client, 1280, 900)
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: injectedFetch })
    await client.send('Page.navigate', { url: APP_URL })
    await waitFor(client, `document.body.innerText.includes('MD-BASIC')`)

    console.log('Markdown stage: fixture loaded')
    const assertions = {}

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
          breakRendered: row.innerText.includes('换行测试第一行') && row.innerText.includes('换行测试第二行'),
        };
      })()`,
    )
    await screenshot(client, '01-basic-typography')

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
    await screenshot(client, '02-lists')

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
          preCanScroll: pre.scrollWidth >= pre.clientWidth,
        };
      })()`,
    )
    await screenshot(client, '03-code-block')

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
          display: getComputedStyle(table).display,
          canScroll: table.scrollWidth >= table.clientWidth,
        };
      })()`,
    )
    await screenshot(client, '04-table-desktop')

    await scrollAssistantToText(client, 'MD-QUOTE-LINK')
    assertions.quoteLinks = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-QUOTE-LINK'));
        const links = [...row.querySelectorAll('a')].map((node) => ({
          href: node.href,
          target: node.getAttribute('target'),
          rel: node.getAttribute('rel'),
        }));
        return {
          blockquote: !!row.querySelector('blockquote'),
          hr: !!row.querySelector('hr'),
          links,
          linkCount: links.length,
          allLinksHttp: links.every((link) => /^https?:/.test(link.href)),
        };
      })()`,
    )
    await screenshot(client, '05-quote-links')

    await scrollAssistantToText(client, 'MD-SAFETY')
    assertions.safety = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-SAFETY'));
        return {
          scriptTags: row.querySelectorAll('script').length,
          imgTags: row.querySelectorAll('img').length,
          javascriptLinks: row.querySelectorAll('a[href^="javascript:"]').length,
          safeLinks: [...row.querySelectorAll('a')].every((node) => !node.href.startsWith('javascript:')),
          xssScript: Boolean(window.__xssFromMarkdown),
          xssImg: Boolean(window.__xssFromImg),
          xssAnchor: Boolean(window.__xssFromAnchor),
          visibleDangerText: row.innerText.includes('危险链接'),
        };
      })()`,
    )
    await screenshot(client, '06-safety-sanitized')

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
    await screenshot(client, '07-user-message-plain')

    console.log('Markdown stage: streaming')
    await clickText(client, 'button', '新建')
    await waitFor(client, `document.body.innerText.includes('CDP Markdown Streaming')`)
    await ask(client, '请返回流式 markdown')
    await waitFor(client, `document.body.innerText.includes('MD-STREAM') && [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`)
    await scrollAssistantToText(client, 'MD-STREAM')
    assertions.streamingMid = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-STREAM'));
        return {
          hasH2: !!row.querySelector('h2'),
          isGenerating: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止'),
          hasAnyCode: !!row.querySelector('code'),
        };
      })()`,
    )
    await screenshot(client, '08-streaming-mid-render')

    await waitIdle(client)
    await scrollAssistantToText(client, 'MD-STREAM')
    assertions.streamingDone = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-STREAM'));
        return {
          h2: !!row.querySelector('h2'),
          preCode: !!row.querySelector('pre code'),
          table: !!row.querySelector('table'),
          done: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送'),
        };
      })()`,
    )
    await screenshot(client, '09-streaming-done-render')

    console.log('Markdown stage: persistence/copy/mobile')
    console.log('Markdown stage: reload persistence')
    await client.send('Page.reload', { ignoreCache: true })
    await waitFor(client, `document.body.innerText.includes('MD-BASIC')`)
    await scrollAssistantToText(client, 'MD-CODE')
    assertions.persistence = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-CODE'));
        return {
          stillRenderedAsCode: !!row.querySelector('pre code'),
          title: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
        };
      })()`,
    )
    await screenshot(client, '10-refresh-persistence')

    console.log('Markdown stage: copy')
    await client.send('Page.bringToFront').catch(() => {})
    await client.send('Browser.grantPermissions', {
      origin: APP_URL,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    }).catch(() => {})
    console.log('Markdown stage: copy scroll')
    await scrollAssistantToText(client, 'MD-BASIC')
    console.log('Markdown stage: copy click')
    await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('MD-BASIC'));
        row.querySelector('.message-action-btn')?.click();
      })()`,
    )
    console.log('Markdown stage: copy wait')
    await waitFor(client, `document.body.innerText.includes('已复制')`)
    console.log('Markdown stage: copy read')
    assertions.copy = await evaluate(
      client,
      `Promise.race([
        navigator.clipboard.readText(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard read timed out')), 3000)),
      ]).then((text) => ({
        containsRawMarkdown: text.includes('# MD-BASIC') && text.includes('**粗体**'),
        containsHtml: text.includes('<h1') || text.includes('<strong>'),
        length: text.length,
      }))`,
    )
    await screenshot(client, '11-copy-raw-markdown')

    console.log('Markdown stage: mobile')
    await setViewport(client, 390, 844, true)
    await delay(300)
    await scrollAssistantToText(client, 'MD-TABLE')
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
          tableOverflowContained: table.scrollWidth >= table.clientWidth,
          preOverflowContained: pre ? pre.scrollWidth >= pre.clientWidth : false,
          shellWidth: shell.getBoundingClientRect().width,
        };
      })()`,
    )
    await screenshot(client, '12-mobile-table-overflow')

    assert(assertions.basic.h1 && assertions.basic.h2 && assertions.basic.inlineCode, 'Markdown basic rendering failed')
    assert(assertions.lists.nested && assertions.lists.li >= 7, 'Markdown list rendering failed')
    assert(assertions.code.preCode && assertions.code.codeText, 'Markdown code rendering failed')
    assert(assertions.table.table && assertions.table.th === 3, 'Markdown table rendering failed')
    assert(assertions.quoteLinks.blockquote && assertions.quoteLinks.allLinksHttp, 'Markdown link rendering failed')
    assert(assertions.safety.scriptTags === 0 && assertions.safety.imgTags === 0 && assertions.safety.javascriptLinks === 0 && assertions.safety.safeLinks, 'Markdown safety failed')
    assert(!assertions.userPlain.hasRenderedHeading && assertions.userPlain.textIncludesFence, 'User markdown plain-text rendering failed')
    assert(assertions.streamingDone.done && assertions.streamingDone.preCode && assertions.streamingDone.table, 'Streaming markdown rendering failed')
    assert(assertions.persistence.stillRenderedAsCode, 'Markdown persistence failed')
    assert(assertions.copy.containsRawMarkdown && !assertions.copy.containsHtml, 'Markdown copy raw text failed')
    assert(!assertions.mobile.pageOverflowX && assertions.mobile.tableOverflowContained && assertions.mobile.preOverflowContained, 'Markdown mobile overflow failed')

    console.log(JSON.stringify(assertions, null, 2))
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
