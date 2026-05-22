import http from 'node:http'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

const SERVER_PORT = process.env.SERVER_PORT || '7702'
const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`
const MOCK_PORT = Number(process.env.MOCK_PORT || 7012)
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}/chat/completions`
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9338)
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-p0-api-screenshots')
const RESULT_FILE = path.join(OUT_DIR, 'results.json')
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const WEATHER_MOCK = path.resolve(process.cwd(), 'tests/cdp/mock-weather-fetch.cjs')
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const PREFIX = `CDPP0-${STAMP}`

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
      this.pending.set(id, { resolve, reject })
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
      if (response.ok || response.status === 404) return
    } catch {
      // keep polling
    }
    await delay(200)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))
  return child
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3000).then(() => child.kill('SIGKILL')),
  ])
}

function llmResponse(content) {
  return {
    choices: [{ message: { content } }],
  }
}

function sse(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`
}

function sseToolCall({ id = 'call_mock_1', name, argsText, reasoningContent = '' }) {
  const splitAt = Math.max(1, Math.floor(argsText.length / 2))
  const firstArgs = argsText.slice(0, splitAt)
  const secondArgs = argsText.slice(splitAt)

  return [
    reasoningContent
      ? `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoningContent } }] })}\n\n`
      : '',
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id,
            type: 'function',
            function: {
              name,
              arguments: ''
            }
          }]
        }
      }]
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: {
              arguments: firstArgs
            }
          }]
        }
      }]
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: {
              arguments: secondArgs
            }
          }]
        },
        finish_reason: 'tool_calls'
      }]
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
}

function writeSse(res, content) {
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
}

function createMockLlmServer() {
  const requests = []
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.writeHead(404).end()
      return
    }

    let raw = ''
    req.setEncoding('utf8')
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const content = body.messages.map((message) => message.content || '').join('\n')
    const latestUserContent = [...body.messages]
      .reverse()
      .find((message) => message.role === 'user')?.content || ''
    const hasToolResult = body.messages.some((message) => message.role === 'tool')
    const assistantToolMessage = body.messages.find((message) => message.role === 'assistant' && message.tool_calls)
    const record = {
      stream: Boolean(body.stream),
      content,
      responseEnded: false,
      responseClosed: false,
      closeBeforeEnd: false,
      chunksSent: 0,
    }
    requests.push(record)
    res.on('close', () => {
      record.responseClosed = true
      record.closeBeforeEnd = !record.responseEnded
    })

    if (!body.stream) {
      let answer = '[]'
      if (content.includes('P0_TOOL_SUCCESS')) {
        answer = '[{"function":"getWeather","args":{"city":"北京","date":"明天"}}]'
      } else if (content.includes('P0_TOOL_FAILURE')) {
        answer = '[{"function":"getWeather","args":{"city":"异常城","date":"今天"}}]'
      } else if (content.includes('P0_TOOL_UNKNOWN')) {
        answer = '[{"function":"missingTool","args":{"city":"北京","date":"明天"}}]'
      } else if (content.includes('P0_TOOL_STOP')) {
        answer = '[{"function":"getWeather","args":{"city":"慢城","date":"明天"}}]'
      } else if (content.includes('P0_TOOL_ANSWER_STOP')) {
        answer = '[{"function":"getWeather","args":{"city":"北京","date":"明天"}}]'
      } else if (content.includes('P0_BAD_FUNCTION_JSON')) {
        answer = '[{"function":"getWeather","args":'
      } else if (content.includes('P0_EMPTY_MODEL')) {
        answer = ''
      } else if (content.includes('P0_DUPLICATE_SLOW')) {
        await delay(1200)
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      record.responseEnded = true
      res.end(JSON.stringify(llmResponse(answer)))
      return
    }

    if (body.tools?.length) {
      if (latestUserContent.includes('P0_MALFORMED_STREAM')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: {"choices":[{"delta":{"content":"broken"}}]\n\n')
        record.chunksSent += 1
        record.responseEnded = true
        res.end()
        return
      }

      let toolCall = null
      if (latestUserContent.includes('P0_TOOL_SUCCESS')) {
        toolCall = { name: 'getWeather', argsText: '{"city":"北京","date":"明天"}' }
      } else if (latestUserContent.includes('P0_TOOL_REASONING')) {
        toolCall = {
          name: 'getWeather',
          argsText: '{"city":"北京","date":"明天"}',
          reasoningContent: '需要先调用天气工具。'
        }
      } else if (latestUserContent.includes('P0_TOOL_PREAMBLE')) {
        toolCall = {
          name: 'getWeather',
          argsText: '{"city":"北京","date":"明天"}',
          preamble: '我先看一下天气 '
        }
      } else if (latestUserContent.includes('P0_TOOL_FAILURE')) {
        toolCall = { name: 'getWeather', argsText: '{"city":"异常城","date":"今天"}' }
      } else if (latestUserContent.includes('P0_TOOL_UNKNOWN')) {
        toolCall = { name: 'missingTool', argsText: '{"city":"北京","date":"明天"}' }
      } else if (latestUserContent.includes('P0_TOOL_STOP')) {
        toolCall = { name: 'getWeather', argsText: '{"city":"慢城","date":"明天"}' }
      } else if (latestUserContent.includes('P0_TOOL_ANSWER_STOP')) {
        toolCall = { name: 'getWeather', argsText: '{"city":"北京","date":"明天"}' }
      } else if (latestUserContent.includes('P0_BAD_FUNCTION_JSON')) {
        toolCall = { name: 'getWeather', argsText: '{"city":"北京","date":' }
      } else if (latestUserContent.includes('P0_DUPLICATE_SLOW')) {
        await delay(1200)
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (toolCall) {
        if (toolCall.preamble) {
          writeSse(res, toolCall.preamble)
          record.chunksSent += 1
        }
        record.responseEnded = true
        res.end(sseToolCall(toolCall))
        return
      }

      let answer = '标准回答'
      if (content.includes('P0CTX_QUERY_A')) {
        const match = content.match(/A_SECRET_[0-9]+/)
        answer = `A_ONLY:${match?.[0] || 'missing'}`
      } else if (content.includes('P0CTX_QUERY_B')) {
        const match = content.match(/B_SECRET_[0-9]+/)
        answer = `B_ONLY:${match?.[0] || 'missing'}`
      } else if (content.includes('P0CTX_A')) {
        answer = '已记住 A。'
      } else if (content.includes('P0CTX_B')) {
        answer = '已记住 B。'
      } else if (content.includes('P0_EMPTY_MODEL')) {
        answer = ''
      }

      record.responseEnded = true
      res.end(sse(answer))
      return
    }

    if (content.includes('P0_MALFORMED_STREAM')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"broken"}}]\n\n')
      record.chunksSent += 1
      record.responseEnded = true
      res.end()
      return
    }

    let answer = '标准回答'
    if (hasToolResult) {
      if (content.includes('unknown tool')) {
        answer = '未找到相关工具，请换一种问法。'
      } else if (content.includes('获取天气数据失败') || content.includes('Failed to call tool')) {
        answer = '天气服务暂时不可用，请稍后重试。'
      } else if (content.includes('天气：')) {
        if (content.includes('P0_TOOL_REASONING')) {
          answer = assistantToolMessage?.content === '' &&
            assistantToolMessage?.reasoning_content === '需要先调用天气工具。'
            ? 'reasoning 已回传，北京明天天气：晴。'
            : 'reasoning 未回传。'
        } else {
          answer = '北京明天天气：晴，气温 18°C ~ 26°C。'
        }
      }
      if (content.includes('P0_TOOL_ANSWER_STOP')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const chunks = ['answer-stage-1 ', 'answer-stage-2 ', 'answer-stage-3 ']
        for (const chunk of chunks) {
          if (res.destroyed) return
          writeSse(res, chunk)
          record.chunksSent += 1
          await delay(250)
        }
        if (!res.destroyed) {
          record.responseEnded = true
          res.end('data: [DONE]\n\n')
        }
        return
      }
    } else if (content.includes('P0CTX_QUERY_A')) {
      const match = content.match(/A_SECRET_[0-9]+/)
      answer = `A_ONLY:${match?.[0] || 'missing'}`
    } else if (content.includes('P0CTX_QUERY_B')) {
      const match = content.match(/B_SECRET_[0-9]+/)
      answer = `B_ONLY:${match?.[0] || 'missing'}`
    } else if (content.includes('P0CTX_A')) {
      answer = '已记住 A。'
    } else if (content.includes('P0CTX_B')) {
      answer = '已记住 B。'
    } else if (content.includes('P0_EMPTY_MODEL')) {
      answer = ''
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    record.responseEnded = true
    res.end(sse(answer))
  })

  return {
    requests,
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

async function waitForEval(client, expression, timeoutMs = 6000) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    if (await evaluate(client, expression)) return
    await delay(80)
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
  return filePath
}

async function api(client, pathName, options = {}) {
  const url = pathName.startsWith('http') ? pathName : `${BASE_URL}${pathName}`
  return evaluate(
    client,
    `fetch(${JSON.stringify(url)}, ${JSON.stringify(options)})
      .then(async (response) => {
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        return { status: response.status, ok: response.ok, data, text };
      })`,
  )
}

async function ask(client, conversationId, question) {
  const requestId = `req_${Math.random().toString(36).slice(2)}_${Date.now()}`
  const url = `${BASE_URL}/conversations/${conversationId}/ask`
  return evaluate(
    client,
    `fetch(${JSON.stringify(url)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: ${JSON.stringify(question)}, requestId: ${JSON.stringify(requestId)} })
    }).then(async (response) => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let text = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return { status: response.status, text };
    })`,
  )
}

async function askWithRequestId(client, conversationId, question, requestId) {
  const url = `${BASE_URL}/conversations/${conversationId}/ask`
  return evaluate(
    client,
    `fetch(${JSON.stringify(url)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: ${JSON.stringify(question)}, requestId: ${JSON.stringify(requestId)} })
    }).then(async (response) => {
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      return { status: response.status, text, data };
    })`,
  )
}

async function askAndAbort(client, conversationId, question) {
  const requestId = `req_${Math.random().toString(36).slice(2)}_${Date.now()}`
  const askUrl = `${BASE_URL}/conversations/${conversationId}/ask`
  const cancelUrl = `${BASE_URL}/requests/${requestId}/cancel`
  return evaluate(
    client,
    `(() => {
      const controller = new AbortController();
      const requestId = ${JSON.stringify(requestId)};
      const task = fetch(${JSON.stringify(askUrl)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: ${JSON.stringify(question)}, requestId }),
        signal: controller.signal
      }).then(async (response) => {
        const reader = response.body.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
        }
        return { completed: true, status: response.status };
      }).catch((error) => ({ completed: false, errorName: error.name }));
      setTimeout(() => {
        controller.abort();
        fetch(${JSON.stringify(cancelUrl)}, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      }, 100);
      return task;
    })()`,
  )
}

async function duplicateRequest(client, conversationId) {
  const requestId = `duplicate_${Date.now()}`
  const url = `${BASE_URL}/conversations/${conversationId}/ask`
  return evaluate(
    client,
    `(() => {
      const body = JSON.stringify({ question: 'P0_DUPLICATE_SLOW 保持请求中', requestId: ${JSON.stringify(requestId)} });
      const first = fetch(${JSON.stringify(url)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      }).then((response) => response.text().then((text) => ({ status: response.status, text })));
      const second = new Promise((resolve) => {
        setTimeout(() => {
          fetch(${JSON.stringify(url)}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
          }).then(async (response) => {
            const text = await response.text();
            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch {}
            resolve({ status: response.status, data, text });
          });
        }, 80);
      });
      return Promise.all([first, second]);
    })()`,
  )
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const mock = createMockLlmServer()
  await mock.start()
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-p0-data-'))
  const conversationsDir = path.join(dataDir, 'conversations')

  const server = spawnProcess('node', ['./bin/www.ts'], {
    cwd: path.resolve(process.cwd(), 'server'),
    env: {
      ...process.env,
      PORT: SERVER_PORT,
      LLM_PROVIDER: 'deepseek',
      LLM_ENDPOINT: MOCK_URL,
      LLM_MODEL: 'cdp-p0-api',
      LLM_TIMEOUT_MS: '10000',
      DEEPSEEK_API_KEY: 'cdp-test-key',
      HEFENG_API_HOST: 'mock.weather.local',
      HEFENG_API_KEY: 'mock-weather-key',
      CONVERSATION_DATA_DIR: dataDir,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${WEATHER_MOCK}`.trim(),
    },
  })

  const profileDir = await mkdtemp(path.join(tmpdir(), 'chatbot-p0-api-cdp-'))
  const chrome = spawnProcess(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars=false',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1280,900',
    `${BASE_URL}/conversations`,
  ])

  const createdIds = []

  try {
    await waitForHttp(`${BASE_URL}/conversations`)
    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`)

    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
    const target =
      targets.find((item) => item.type === 'page' && item.url.startsWith(BASE_URL)) ||
      targets.find((item) => item.type === 'page')
    const client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Page.navigate', { url: `${BASE_URL}/conversations` })
    await waitForEval(
      client,
      `location.origin === ${JSON.stringify(BASE_URL)} && document.readyState !== 'loading'`,
    )

    const unknownCancel = await api(client, '/requests/not-active-123/cancel', { method: 'POST' })
    assert(unknownCancel.status === 200 && unknownCancel.data.cancelled === false, 'P0-09 unknown cancel failed')

    const created = await api(client, '/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${PREFIX}-CRUD` }),
    })
    const crudId = created.data.conversation.id
    createdIds.push(crudId)
    const crudFile = path.join(conversationsDir, `${crudId}.json`)
    assert(await fileExists(crudFile), 'P0-12 conversation file was not created')

    const renamed = await api(client, `/conversations/${crudId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${PREFIX}-RENAMED` }),
    })
    assert(renamed.data.conversation.title === `${PREFIX}-RENAMED`, 'P0-10 rename failed')

    const blankRename = await api(client, `/conversations/${crudId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    })
    assert(blankRename.status === 400 && blankRename.data.message, 'P0-13 400 JSON failed')

    const invalidAsk = await askWithRequestId(client, crudId, 'invalid request id', 'bad')
    assert(invalidAsk.status === 400 && invalidAsk.data.message, 'P0-18 invalid requestId JSON failed')

    const duplicate = await duplicateRequest(client, crudId)
    assert(duplicate[1].status === 409 && duplicate[1].data.message, 'P0-19 duplicate requestId JSON failed')

    const cleared = await api(client, `/conversations/${crudId}/clear`, { method: 'POST' })
    assert(cleared.data.conversation.messages.length === 0, 'P0-10 clear failed')

    await screenshot(client, '01-crud-json-state')

    const secretA = `A_SECRET_${Date.now()}`
    const secretB = `B_SECRET_${Date.now()}`
    const convA = await api(client, '/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${PREFIX}-A` }),
    })
    const convB = await api(client, '/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${PREFIX}-B` }),
    })
    const idA = convA.data.conversation.id
    const idB = convB.data.conversation.id
    createdIds.push(idA, idB)

    await ask(client, idA, `P0CTX_A 请记住 ${secretA}`)
    await ask(client, idB, `P0CTX_B 请记住 ${secretB}`)
    const answerA = await ask(client, idA, 'P0CTX_QUERY_A 请只回答 A 秘密')
    const answerB = await ask(client, idB, 'P0CTX_QUERY_B 请只回答 B 秘密')
    assert(answerA.text.includes(secretA) && !answerA.text.includes(secretB), 'P0-11 A context isolation failed')
    assert(answerB.text.includes(secretB) && !answerB.text.includes(secretA), 'P0-11 B context isolation failed')

    await screenshot(client, '02-context-isolation-json-state')

    const toolConv = await api(client, '/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${PREFIX}-TOOLS` }),
    })
    const toolId = toolConv.data.conversation.id
    createdIds.push(toolId)

    const toolSuccess = await ask(client, toolId, 'P0_TOOL_SUCCESS 查询北京明天天气')
    const toolReasoning = await ask(client, toolId, 'P0_TOOL_REASONING 查询北京明天天气')
    const toolPreamble = await ask(client, toolId, 'P0_TOOL_PREAMBLE 工具调用前先输出一些文字')
    const toolFailure = await ask(client, toolId, 'P0_TOOL_FAILURE 查询异常城今天天气')
    const toolUnknown = await ask(client, toolId, 'P0_TOOL_UNKNOWN 调用不存在工具')
    assert(toolSuccess.text.includes('北京明天天气'), 'P0-14 tool success failed')
    assert(toolReasoning.text.includes('reasoning 已回传'), 'P0-14 tool reasoning_content was not passed back')
    assert(
      toolPreamble.text.includes('北京明天天气') && !toolPreamble.text.includes('我先看一下天气'),
      'P0-14 tool preamble leaked before tool result answer'
    )
    assert(toolFailure.text.includes('天气服务暂时不可用'), 'P0-15 tool failure fallback failed')
    assert(toolUnknown.text.includes('未找到相关工具'), 'P0-16 unknown tool fallback failed')

    const stopConv = await api(client, '/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${PREFIX}-TOOL-STOP` }),
    })
    const stopId = stopConv.data.conversation.id
    createdIds.push(stopId)
    const stopped = await askAndAbort(client, stopId, 'P0_TOOL_STOP 查询慢城明天天气')
    await delay(500)
    const stoppedDetail = await api(client, `/conversations/${stopId}`)
    assert(stopped.completed === false || stopped.errorName === 'AbortError', 'P0-17 browser fetch was not aborted')
    assert(stoppedDetail.data.conversation.messages.length === 0, 'P0-17 aborted tool request was persisted')

    await screenshot(client, '03-tool-json-state')

    const answerStopConv = await api(client, '/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${PREFIX}-ANSWER-STOP` }),
    })
    const answerStopId = answerStopConv.data.conversation.id
    createdIds.push(answerStopId)
    const answerStopped = await askAndAbort(client, answerStopId, 'P0_TOOL_ANSWER_STOP 查询北京明天天气')
    await delay(500)
    const answerStopDetail = await api(client, `/conversations/${answerStopId}`)
    const answerStreamRecord = mock.requests.findLast?.((request) => request.stream && request.content.includes('P0_TOOL_ANSWER_STOP')) ||
      [...mock.requests].reverse().find((request) => request.stream && request.content.includes('P0_TOOL_ANSWER_STOP'))
    assert(answerStopped.completed === false || answerStopped.errorName === 'AbortError', 'P0-24 answer-stage fetch was not aborted')
    assert(answerStreamRecord?.closeBeforeEnd === true, 'P0-24 answer-stage upstream stream was not closed early')
    assert(answerStopDetail.data.conversation.messages.length === 0, 'P0-24 aborted answer-stage request was persisted')

    const badFunctionJson = await ask(client, toolId, 'P0_BAD_FUNCTION_JSON 触发非法函数 JSON')
    const malformedStream = await ask(client, toolId, 'P0_MALFORMED_STREAM 触发损坏流')
    const emptyModel = await ask(client, toolId, 'P0_EMPTY_MODEL 触发空模型响应')
    const recovery = await ask(client, toolId, 'P0_RECOVERY 确认异常后还能继续')
    assert(badFunctionJson.text.includes('标准回答') && badFunctionJson.text.includes('"type":"done"'), 'P0-20 invalid function JSON did not fallback to standard answer')
    assert(malformedStream.text.includes('"type":"error"'), 'P0-21 malformed stream did not return stream error')
    assert(emptyModel.text.includes('"type":"error"'), 'P0-23 empty model did not return stream error')
    assert(recovery.text.includes('标准回答') && recovery.text.includes('"type":"done"'), 'P0-25 recovery request failed after errors')

    const titleConv = await api(client, '/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '新的聊天' }),
    })
    const titleId = titleConv.data.conversation.id
    createdIds.push(titleId)
    assert(titleConv.data.conversation.title === '新的聊天', 'P1-26 default title failed')
    await ask(client, titleId, '这是用于生成标题的第一条用户消息，需要被截断')
    const titleAfterFirstAsk = await api(client, `/conversations/${titleId}`)
    assert(titleAfterFirstAsk.data.conversation.title.startsWith('这是用于生成标题的第一条'), 'P1-27 title was not generated from first user message')
    await api(client, `/conversations/${titleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${PREFIX}-MANUAL-TITLE` }),
    })
    await ask(client, titleId, '第二条消息不应该覆盖手动标题')
    const titleAfterManualRename = await api(client, `/conversations/${titleId}`)
    assert(titleAfterManualRename.data.conversation.title === `${PREFIX}-MANUAL-TITLE`, 'P1-28 manual title was overwritten')

    const legacyDataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-legacy-data-'))
    const legacyServer = spawnProcess('node', ['./bin/www.ts'], {
      cwd: path.resolve(process.cwd(), 'server'),
      env: {
        ...process.env,
        PORT: '7703',
        CONVERSATION_DATA_DIR: legacyDataDir,
        LLM_PROVIDER: 'deepseek',
        LLM_ENDPOINT: MOCK_URL,
        LLM_MODEL: 'cdp-p0-api',
        DEEPSEEK_API_KEY: 'cdp-test-key',
      },
    })
    try {
      await mkdir(path.join(legacyDataDir, 'conversations'), { recursive: true })
      await writeFile(path.join(legacyDataDir, 'conversations.json'), JSON.stringify({
        conversations: [{
          id: 'conv_legacy_cdp',
          title: `${PREFIX}-LEGACY`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [{ role: 'user', content: 'legacy' }],
        }],
      }), 'utf8')
      await waitForHttp('http://127.0.0.1:7703/conversations')
      const legacyList = await (await fetch('http://127.0.0.1:7703/conversations')).json()
      assert(legacyList.conversations.some((item) => item.id === 'conv_legacy_cdp'), 'P1-29 legacy conversation was not migrated')
      assert(await fileExists(path.join(legacyDataDir, 'conversations.json.migrated')), 'P1-29 legacy migrated marker missing')
      const legacyListAgain = await (await fetch('http://127.0.0.1:7703/conversations')).json()
      assert(legacyListAgain.conversations.filter((item) => item.id === 'conv_legacy_cdp').length === 1, 'P1-30 legacy migration was repeated')
    } finally {
      await stopProcess(legacyServer)
    }

    const corruptDataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-corrupt-data-'))
    await mkdir(path.join(corruptDataDir, 'conversations'), { recursive: true })
    await writeFile(path.join(corruptDataDir, 'conversations', 'conv_corrupt_cdp.json'), '{broken json', 'utf8')
    const corruptServer = spawnProcess('node', ['./bin/www.ts'], {
      cwd: path.resolve(process.cwd(), 'server'),
      env: {
        ...process.env,
        PORT: '7704',
        CONVERSATION_DATA_DIR: corruptDataDir,
        LLM_PROVIDER: 'deepseek',
        LLM_ENDPOINT: MOCK_URL,
        LLM_MODEL: 'cdp-p0-api',
        DEEPSEEK_API_KEY: 'cdp-test-key',
      },
    })
    try {
      await waitForHttp('http://127.0.0.1:7704/__ready')
      const corruptResponse = await fetch('http://127.0.0.1:7704/conversations')
      const corruptText = await corruptResponse.text()
      let corruptJson = null
      try { corruptJson = JSON.parse(corruptText) } catch {}
      assert(corruptResponse.status >= 500 && corruptJson?.message, 'P1-31 corrupt JSON did not return JSON error')
      const healthAfterCorrupt = await fetch('http://127.0.0.1:7704/__ready')
      assert(healthAfterCorrupt.status === 404, 'P1-31 corrupt JSON server crashed after error')
    } finally {
      await stopProcess(corruptServer)
    }

    const deleted = await api(client, `/conversations/${crudId}`, { method: 'DELETE' })
    assert(deleted.status === 204, 'P0-10 delete failed')
    const deletedGet = await api(client, `/conversations/${crudId}`)
    assert(deletedGet.status === 404 && deletedGet.data.message, 'P0-13 404 JSON failed')
    createdIds.splice(createdIds.indexOf(crudId), 1)

    const summary = {
      allPassed: true,
      cases: {
        'P0-09': 'passed',
        'P0-10': 'passed',
        'P0-11': 'passed',
        'P0-12': 'passed',
        'P0-13': 'passed',
        'P0-14': 'passed',
        'P0-15': 'passed',
        'P0-16': 'passed',
        'P0-17': 'passed',
        'P0-18': 'passed',
        'P0-19': 'passed',
        'P0-20': 'passed',
        'P0-21': 'passed',
        'P0-23': 'passed',
        'P0-24': 'passed',
        'P0-25': 'passed',
        'P1-26': 'passed',
        'P1-27': 'passed',
        'P1-28': 'passed',
        'P1-29': 'passed',
        'P1-30': 'passed',
        'P1-31': 'passed',
      },
      toolSuccess: toolSuccess.text,
      toolReasoning: toolReasoning.text,
      toolPreamble: toolPreamble.text,
      toolFailure: toolFailure.text,
      toolUnknown: toolUnknown.text,
      stopped,
      answerStopped,
      llmRequestCount: mock.requests.length,
    }

    await writeFile(RESULT_FILE, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(summary, null, 2))
    client.close()
  } finally {
    for (const id of createdIds) {
      await fetch(`${BASE_URL}/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    }
    await stopProcess(chrome)
    await stopProcess(server)
    await mock.stop()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
