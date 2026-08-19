import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9338)
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-highlight-screenshots')
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

      if (!payload.id) {
        const listeners = this.events.get(payload.method)
        if (listeners) {
          for (const listener of listeners) {
            listener(payload.params || {})
          }
        }
        return
      }

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

async function ensureClipboard(client) {
  await client.send('Page.bringToFront').catch(() => {})
  await client.send('Browser.grantPermissions', {
    origin: new URL(APP_URL).origin,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  }).catch(() => {})
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

const registeredLanguagesMarkdown = [
  '## HL-REGISTERED 多语言高亮',
  '',
  '~~~typescript',
  'type User = { id: number; name: string }',
  'const user: User = { id: 1, name: "Ada" }',
  'function greet(input: User) { return `hello ${input.name}` }',
  '~~~',
  '',
  '~~~javascript',
  'const items = [1, 2, 3]',
  'items.map((item) => item * 2).forEach(console.log)',
  '~~~',
  '',
  '~~~json',
  '{ "name": "chatbot", "enabled": true, "count": 3 }',
  '~~~',
  '',
  '~~~bash',
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'APP_URL="http://localhost:5173"',
  'if curl -sS "$APP_URL" >/dev/null; then',
  '  echo "ready"',
  'fi',
  '~~~',
  '',
  '~~~python',
  'def add(a: int, b: int) -> int:',
  '    return a + b',
  'print(add(1, 2))',
  '~~~',
  '',
  '~~~sql',
  'select id, title from conversations where message_count > 0 order by updated_at desc;',
  '~~~',
].join('\n')

const edgeMarkdown = [
  '## HL-EDGE 回退和容错',
  '',
  '### 未知语言 foobar',
  '',
  '~~~foobar',
  'function unknownLanguage(value) { return value + 1 }',
  'const text = "auto fallback should not crash"',
  '~~~',
  '',
  '### 无语言自动识别',
  '',
  '~~~',
  'const autoDetected = true',
  'if (autoDetected) { console.log("ok") }',
  '~~~',
  '',
  '### 非法 JSON 容错',
  '',
  '~~~json',
  '{ name: "missing quotes", trailing: true, }',
  '~~~',
  '',
  '### 行内代码和块级代码',
  '',
  '行内代码 `const inline = true` 不应该带 hljs token。',
  '',
  '~~~css',
  '.message { color: #2563eb; display: grid; }',
  '~~~',
  '',
  '### 长代码行',
  '',
  '~~~typescript',
  'const veryLongLine = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"',
  '~~~',
].join('\n')

const newLanguagesMarkdown = [
  '## HL-NEW-LANG Go C C++ Rust JSX MJS TSX',
  '',
  '~~~go',
  'package main',
  '',
  '// Go 行注释',
  '/* Go 块注释 */',
  'func add(a int, b int) int',
  '{',
  '    return a + b',
  '}',
  '~~~',
  '',
  '~~~c',
  '#include <stdio.h>',
  '',
  '// C 行注释',
  '/* C 块注释 */',
  'int add(int a, int b)',
  '{',
  '    return a + b;',
  '}',
  '~~~',
  '',
  '~~~cpp',
  '#include <vector>',
  '',
  '// C++ 行注释',
  '/* C++ 块注释 */',
  'int add(int a, int b)',
  '{',
  '    return a + b;',
  '}',
  '~~~',
  '',
  '~~~rust',
  '// Rust 行注释',
  '/* Rust 块注释 */',
  'fn add(a: i32, b: i32) -> i32',
  '{',
  '    a + b',
  '}',
  '~~~',
  '',
  '~~~jsx',
  'const Button = ({ label }) =>',
  '{',
  '  // JSX 行注释',
  '  return <button className="primary">{label}</button>',
  '}',
  '~~~',
  '',
  '~~~mjs',
  '// MJS 行注释',
  'export function add(a, b)',
  '{',
  '  return a + b',
  '}',
  '~~~',
  '',
  '~~~tsx',
  'type Props = { label: string }',
  'export function Button({ label }: Props)',
  '{',
  '  /* TSX 块注释 */',
  '  return <button>{label}</button>',
  '}',
  '~~~',
].join('\n')

const safetyMarkdown = [
  '## HL-SAFETY 安全代码块',
  '',
  '下面危险内容必须作为代码文本显示，不能生成真实 script/img。',
  '',
  '~~~html',
  '<script>window.__highlightScriptRan = true</script>',
  '<img src=x onerror="window.__highlightImgRan=true">',
  '<div onclick="window.__highlightClickRan=true">safe text</div>',
  '~~~',
].join('\n')

const fixtures = {
  id: 'highlight-fixture',
  title: 'CDP Highlight Fixture',
  createdAt: '2026-05-18T12:20:00.000Z',
  updatedAt: '2026-05-18T12:20:00.000Z',
  titleManuallyEdited: true,
  messages: [
    { role: 'assistant', content: registeredLanguagesMarkdown },
    { role: 'assistant', content: edgeMarkdown },
    { role: 'assistant', content: newLanguagesMarkdown },
    { role: 'assistant', content: safetyMarkdown },
  ],
}

const injectedFetch = `
(() => {
  const encoder = new TextEncoder();
  const fixture = ${JSON.stringify(fixtures)};
  const conversations = new Map([[fixture.id, fixture]]);

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

    if (pathname === '/auth/status' && method === 'GET') return json({ enabled: false });

    if (pathname === '/runtime-config' && method === 'GET') {
      return json({
        runtime: {
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          storageBackend: 'file',
          endpointConfigured: true,
          apiKeyConfigured: true,
          providers: [{
            id: 'deepseek',
            label: 'DeepSeek',
            configured: true,
            endpointConfigured: true,
            apiKeyConfigured: true,
            defaultModel: 'deepseek-v4-flash',
            models: [{
              provider: 'deepseek',
              id: 'deepseek-v4-flash',
              label: 'DeepSeek V4 Flash',
              capabilities: {
                tools: true,
                reasoning: true,
                reasoningSummary: false,
                reasoningEfforts: ['low', 'medium', 'high', 'max'],
                temperature: true,
                maxOutputTokens: 65536,
              },
            }],
          }],
          defaults: {
            temperature: null,
            maxTokens: null,
            reasoningEnabled: false,
            reasoningEffort: 'medium',
          },
        },
      });
    }

    if (pathname === '/conversations' && method === 'GET') {
      return json({ conversations: [...conversations.values()].map(summary) });
    }

    if (pathname === '/conversations' && method === 'POST') {
      const conversation = {
        id: 'highlight-stream',
        title: 'CDP Highlight Streaming',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        titleManuallyEdited: true,
        messages: [],
      };
      conversations.set(conversation.id, conversation);
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

      const chunks = [
        '## HL-STREAM 流式高亮\\n\\n~~~typescript\\n',
        'type StreamState = { done: boolean }\\nconst state: StreamState = { done: false }\\n',
        'state.done = true\\n~~~\\n',
      ];
      const finalMarkdown = chunks.join('');

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
})();
`

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const profileDir = await mkdtemp(path.join(tmpdir(), 'chatbot-highlight-cdp-'))
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
      origin: new URL(APP_URL).origin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    }).catch(() => {})
    await setViewport(client, 1280, 900)
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: injectedFetch })
    await client.send('Page.navigate', { url: APP_URL })
    await waitFor(client, `document.body.innerText.includes('HL-REGISTERED')`)

    console.log('Highlight stage: fixtures loaded')
    const assertions = {}

    await scrollAssistantToText(client, 'HL-REGISTERED')
    assertions.registeredLanguages = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-REGISTERED'));
        const codes = [...row.querySelectorAll('pre code')];
        return {
          blockCount: codes.length,
          languageClasses: codes.map((code) => [...code.classList].filter((name) => name.startsWith('language-'))),
          highlightedBlocks: codes.filter((code) => code.querySelector('[class^="hljs-"], [class*=" hljs-"]')).length,
          hasKeyword: !!row.querySelector('.hljs-keyword'),
          hasString: !!row.querySelector('.hljs-string'),
          hasNumber: !!row.querySelector('.hljs-number'),
        };
      })()`,
    )
    await screenshot(client, '01-registered-languages')

    await scrollAssistantToText(client, '未知语言 foobar')
    assertions.fallback = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-EDGE'));
        const unknown = [...row.querySelectorAll('pre code')].find((code) => code.className.includes('language-foobar'));
        const auto = [...row.querySelectorAll('pre code')].find((code) => !code.className.includes('language-') && code.textContent.includes('autoDetected'));
        return {
          unknownBlock: !!unknown,
          unknownHighlighted: !!unknown?.querySelector('[class^="hljs-"], [class*=" hljs-"]'),
          autoBlock: !!auto,
          autoHighlighted: !!auto?.querySelector('[class^="hljs-"], [class*=" hljs-"]'),
          noErrorText: !document.body.innerText.includes('响应失败'),
        };
      })()`,
    )
    await screenshot(client, '02-fallback-auto-detect')

    await scrollAssistantToText(client, '非法 JSON 容错')
    assertions.invalidJson = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-EDGE'));
        const json = [...row.querySelectorAll('pre code')].find((code) => code.className.includes('language-json') && code.textContent.includes('missing quotes'));
        return {
          jsonBlock: !!json,
          highlighted: !!json?.querySelector('[class^="hljs-"], [class*=" hljs-"]'),
          noErrorText: !document.body.innerText.includes('响应失败'),
        };
      })()`,
    )
    await screenshot(client, '03-invalid-json')

    await scrollAssistantToText(client, '行内代码和块级代码')
    assertions.inlineVsBlock = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-EDGE'));
        const inline = [...row.querySelectorAll('p code')].find((code) => code.textContent.includes('inline'));
        const block = [...row.querySelectorAll('pre code')].find((code) => code.className.includes('language-css'));
        return {
          inlineExists: !!inline,
          inlineHasHljsToken: !!inline?.querySelector('[class^="hljs-"], [class*=" hljs-"]'),
          blockExists: !!block,
          blockHasHljsToken: !!block?.querySelector('[class^="hljs-"], [class*=" hljs-"]'),
        };
      })()`,
    )
    await screenshot(client, '04-inline-vs-block')

    await scrollAssistantToText(client, '长代码行')
    assertions.longLineStyle = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-EDGE'));
        const pre = [...row.querySelectorAll('pre')].find((node) => node.textContent.includes('veryLongLine'));
        const code = pre?.querySelector('code');
        const preStyle = pre ? getComputedStyle(pre) : null;
        const codeStyle = code ? getComputedStyle(code) : null;
        return {
          preExists: !!pre,
          preOverflowX: preStyle?.overflowX,
          preBackground: preStyle?.backgroundColor,
          codeBackground: codeStyle?.backgroundColor,
          canScroll: pre ? pre.scrollWidth > pre.clientWidth : false,
        };
      })()`,
    )
    await screenshot(client, '05-long-line-style')

    console.log('Highlight stage: language coverage')
    await scrollAssistantToText(client, 'HL-NEW-LANG')
    assertions.newLanguages = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-NEW-LANG'));
        const codes = [...row.querySelectorAll('pre code')];
        const expectedLanguages = ['go', 'c', 'cpp', 'jsx', 'mjs', 'rust', 'tsx'];
        return {
          blockCount: codes.length,
          languageClasses: codes.map((code) => [...code.classList].filter((name) => name.startsWith('language-'))),
          allExpectedPresent: expectedLanguages.every((language) =>
            codes.some((code) => code.classList.contains(\`language-\${language}\`)),
          ),
          highlightedBlocks: codes.filter((code) => code.querySelector('[class^="hljs-"], [class*=" hljs-"]')).length,
          containsBraces: codes.every((code) => code.textContent.includes('{') && code.textContent.includes('}')),
          hasGo: !!row.querySelector('code.language-go'),
          hasC: !!row.querySelector('code.language-c'),
          hasCpp: !!row.querySelector('code.language-cpp'),
          hasRust: !!row.querySelector('code.language-rust'),
          hasJsx: !!row.querySelector('code.language-jsx'),
          hasMjs: !!row.querySelector('code.language-mjs'),
          hasTsx: !!row.querySelector('code.language-tsx'),
        };
      })()`,
    )
    await screenshot(client, '06-new-languages')

    await scrollAssistantToText(client, 'Go 行注释')
    assertions.bracesAndComments = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-NEW-LANG'));
        const code = row.querySelector('pre code.language-go');
        const pre = code.closest('pre');
        const preStyle = getComputedStyle(pre);
        const codeStyle = getComputedStyle(code);
        return {
          bracesVisibleText: code.textContent.includes('\\n{\\n') && code.textContent.includes('\\n}\\n'),
          lineComments: [...row.querySelectorAll('pre code')].filter((node) => node.textContent.includes('行注释')).length,
          blockComments: [...row.querySelectorAll('pre code')].filter((node) => node.textContent.includes('块注释')).length,
          commentTokens: row.querySelectorAll('.hljs-comment').length,
          codeColor: codeStyle.color,
          preBackground: preStyle.backgroundColor,
          codeColorDiffersFromBackground: codeStyle.color !== preStyle.backgroundColor,
        };
      })()`,
    )
    await screenshot(client, '07-braces-comments')

    await scrollAssistantToText(client, 'HL-SAFETY')
    assertions.safety = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-SAFETY'));
        const code = row.querySelector('pre code');
        return {
          codeBlock: !!code,
          codeContainsScriptText: code?.textContent.includes('<script>'),
          scriptTags: row.querySelectorAll('script').length,
          imgTags: row.querySelectorAll('img').length,
          scriptRan: Boolean(window.__highlightScriptRan),
          imgRan: Boolean(window.__highlightImgRan),
          hasHighlightToken: !!code?.querySelector('[class^="hljs-"], [class*=" hljs-"]'),
        };
      })()`,
    )
    await screenshot(client, '08-safety-code-block')

    console.log('Highlight stage: streaming')
    await evaluate(client, `document.querySelector('.new-chat-btn')?.click()`)
    await waitFor(client, `document.body.innerText.includes('CDP Highlight Streaming')`)
    await ask(client, '请返回流式高亮代码块')
    await waitFor(
      client,
      `[...document.querySelectorAll('.message-row.assistant')].some((node) => node.innerText.includes('HL-STREAM')) &&
        [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`,
    )
    await scrollAssistantToText(client, 'HL-STREAM')
    assertions.streamingMid = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-STREAM'));
        const code = row?.querySelector('pre code');
        return {
          hasHeading: !!row?.querySelector('h2'),
          isGenerating: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止'),
          codeBlockVisible: !!code,
        };
      })()`,
    )
    await screenshot(client, '09-streaming-mid')

    await waitIdle(client)
    await scrollAssistantToText(client, 'HL-STREAM')
    assertions.streamingDone = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-STREAM'));
        const code = row?.querySelector('pre code');
        return {
          hasHeading: !!row?.querySelector('h2'),
          codeBlockVisible: !!code,
          highlighted: !!code?.querySelector('[class^="hljs-"], [class*=" hljs-"]'),
          done: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送'),
        };
      })()`,
    )
    await screenshot(client, '10-streaming-done-highlighted')

    console.log('Highlight stage: persistence/copy/mobile')
    await client.send('Page.reload', { ignoreCache: true })
    await waitFor(client, `document.body.innerText.includes('HL-REGISTERED')`)
    await scrollAssistantToText(client, 'HL-REGISTERED')
    assertions.persistence = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-REGISTERED'));
        return {
          stillHighlighted: !!row?.querySelector('pre code [class^="hljs-"], pre code [class*=" hljs-"]'),
          title: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
        };
      })()`,
    )
    await screenshot(client, '11-refresh-persistence')

    await ensureClipboard(client)
    await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-REGISTERED'));
        row.querySelector('.message-action-btn')?.click();
      })()`,
    )
    await waitFor(client, `document.body.innerText.includes('已复制')`)
    assertions.copy = await evaluate(
      client,
      `Promise.race([
        navigator.clipboard.readText(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard read timed out')), 3000)),
      ]).then((text) => ({
          containsRawFence: text.includes('~~~typescript') || text.includes(${JSON.stringify('```typescript')}),
          containsHljsHtml: text.includes('hljs-') || text.includes('<span'),
          length: text.length,
        }))`,
    )
    await screenshot(client, '12-copy-raw-markdown')

    await setViewport(client, 390, 844, true)
    await delay(300)
    await scrollAssistantToText(client, '长代码行')
    assertions.mobile = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].find((node) => node.innerText.includes('HL-EDGE'));
        const pre = [...row.querySelectorAll('pre')].find((node) => node.textContent.includes('veryLongLine'));
        return {
          viewportWidth: window.innerWidth,
          pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
          preOverflowContained: pre ? pre.scrollWidth > pre.clientWidth : false,
          highlighted: !!pre?.querySelector('[class^="hljs-"], [class*=" hljs-"]'),
        };
      })()`,
    )
    await screenshot(client, '13-mobile-long-code')

    assert(assertions.registeredLanguages.blockCount === 6 && assertions.registeredLanguages.highlightedBlocks === 6, 'Registered language highlighting failed')
    assert(assertions.fallback.unknownHighlighted && assertions.fallback.autoHighlighted, 'Highlight fallback failed')
    assert(assertions.invalidJson.highlighted && assertions.invalidJson.noErrorText, 'Invalid JSON highlight fallback failed')
    assert(!assertions.inlineVsBlock.inlineHasHljsToken && assertions.inlineVsBlock.blockHasHljsToken, 'Inline/block highlight separation failed')
    assert(assertions.longLineStyle.canScroll, 'Long code line overflow failed')
    assert(assertions.newLanguages.allExpectedPresent && assertions.newLanguages.highlightedBlocks === 7, 'New language highlighting failed')
    assert(assertions.bracesAndComments.bracesVisibleText && assertions.bracesAndComments.commentTokens >= 2, 'Braces/comments highlighting failed')
    assert(!assertions.safety.scriptRan && !assertions.safety.imgRan && assertions.safety.codeContainsScriptText, 'Highlight safety failed')
    assert(assertions.streamingDone.done && assertions.streamingDone.highlighted, 'Streaming highlight failed')
    assert(assertions.persistence.stillHighlighted, 'Highlight persistence failed')
    assert(assertions.copy.containsRawFence && !assertions.copy.containsHljsHtml, 'Highlight copy raw markdown failed')
    assert(!assertions.mobile.pageOverflowX && assertions.mobile.preOverflowContained && assertions.mobile.highlighted, 'Highlight mobile overflow failed')

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
