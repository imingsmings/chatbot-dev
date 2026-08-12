import http from 'node:http'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { sse, sseToolCall, writeSse } from './helpers/mockStream.mjs'

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
      if (latestUserContent.includes('P0_INCOMPLETE_STREAM')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        writeSse(res, 'incomplete partial output')
        record.chunksSent += 1
        record.responseEnded = true
        res.end()
        return
      }

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
      } else if (
        latestUserContent.includes('P0_TOOL_CONTEXT_QUERY') &&
        content.includes('P0_TOOL_CONTEXT_CITY_BEIJING')
      ) {
        toolCall = { name: 'getWeather', argsText: '{"city":"北京","date":"明天"}' }
      } else if (latestUserContent.includes('P0_TOOL_PREAMBLE')) {
        toolCall = {
          name: 'getWeather',
          argsText: '{"city":"北京","date":"明天"}',
          preamble: '我先看一下天气 '
        }
      } else if (latestUserContent.includes('P0_TOOL_LONG_PREAMBLE')) {
        toolCall = {
          name: 'getWeather',
          argsText: '{"city":"北京","date":"明天"}',
          preamble: 'LONG_PREAMBLE_MARKER '.repeat(12)
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

      if (latestUserContent.includes('P0_TOOLLESS_STREAM')) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先思考普通回答。' } }] })}\n\n`)
        record.chunksSent += 1

        const chunks = ['普通流式回答第一段，', '第二段继续输出，', '第三段仍在流式，', '普通流式回答结束。']
        for (const chunk of chunks) {
          if (res.destroyed) return
          writeSse(res, chunk)
          record.chunksSent += 1
          await delay(90)
        }

        if (!res.destroyed) {
          record.responseEnded = true
          res.end('data: [DONE]\n\n')
        }
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
        if (latestUserContent.includes('P0_TOOL_REASONING')) {
          answer = assistantToolMessage?.content === '' &&
            assistantToolMessage?.reasoning_content === '需要先调用天气工具。'
            ? 'reasoning 已回传，北京明天天气：晴。'
            : 'reasoning 未回传。'
        } else if (latestUserContent.includes('P0_TOOL_CONTEXT_QUERY')) {
          answer = '上下文城市工具调用成功，北京明天天气：晴。'
        } else {
          answer = '北京明天天气：晴，气温 18°C ~ 26°C。'
        }
      }
      if (latestUserContent.includes('P0_TOOL_ANSWER_STOP')) {
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
      return {
        status: response.status,
        protocol: response.headers.get('X-Chat-Stream-Protocol'),
        text
      };
    })`,
  )
}

async function askStreamEvents(client, conversationId, question) {
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
      const startedAt = performance.now();
      const events = [];
      const chunks = [];
      let buffer = '';
      let text = '';

      const eventTime = () => Math.round(performance.now() - startedAt);
      const handleLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          events.push({ ...JSON.parse(trimmed), atMs: eventTime() });
        } catch {
          events.push({ type: 'parse_error', content: trimmed, atMs: eventTime() });
        }
      };

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const chunkText = decoder.decode(chunk.value, { stream: true });
        chunks.push({ atMs: eventTime(), text: chunkText });
        text += chunkText;
        buffer += chunkText;
        const lines = buffer.split('\\n');
        buffer = lines.pop() || '';
        for (const line of lines) handleLine(line);
      }

      buffer += decoder.decode();
      if (buffer.trim()) handleLine(buffer);

      return {
        status: response.status,
        protocol: response.headers.get('X-Chat-Stream-Protocol'),
        events,
        chunks,
        text
      };
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch {}
  return { status: response.status, ok: response.ok, data, text, response }
}

async function askDirect(baseUrl, conversationId, question) {
  const requestId = `req_${Math.random().toString(36).slice(2)}_${Date.now()}`
  const response = await fetch(`${baseUrl}/conversations/${conversationId}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, requestId }),
  })
  const text = await response.text()
  return {
    status: response.status,
    protocol: response.headers.get('X-Chat-Stream-Protocol'),
    text,
  }
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
        fetch(${JSON.stringify(cancelUrl)}, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'manual' })
        }).catch(() => {}).finally(() => controller.abort());
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

async function runSqliteStorageScenario() {
  const sqliteDataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-sqlite-data-'))
  const sqliteFileDataDir = path.join(sqliteDataDir, 'file')
  const sqliteConversationsDir = path.join(sqliteFileDataDir, 'conversations')
  const sqliteDbPath = path.join(sqliteDataDir, 'sqlite', 'conversations.sqlite3')
  const sqliteUrl = 'http://127.0.0.1:7705'
  const timestamp = new Date().toISOString()
  const fileSeed = {
    id: 'conv_sqlite_file_seed',
    title: 'SQLite file seed',
    createdAt: timestamp,
    updatedAt: timestamp,
    titleManuallyEdited: true,
    messages: [{ role: 'user', content: 'file seed' }],
  }
  const legacySeed = {
    id: 'conv_sqlite_legacy_seed',
    title: 'SQLite legacy seed',
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [{ role: 'assistant', content: 'legacy seed', reasoningContent: 'legacy reasoning', reasoningDurationMs: 3 }],
  }

  await mkdir(sqliteConversationsDir, { recursive: true })
  await writeFile(path.join(sqliteConversationsDir, `${fileSeed.id}.json`), `${JSON.stringify(fileSeed, null, 2)}\n`, 'utf8')
  await writeFile(path.join(sqliteFileDataDir, 'conversations.json'), JSON.stringify({ conversations: [legacySeed] }), 'utf8')

  async function startSqliteServer() {
    const server = spawnProcess('node', ['./bin/www.ts'], {
      cwd: path.resolve(process.cwd(), 'server'),
      env: {
        ...process.env,
        PORT: '7705',
        CONVERSATION_STORE: 'sqlite',
        CONVERSATION_DATA_DIR: sqliteDataDir,
        CONVERSATION_DB_PATH: sqliteDbPath,
        LLM_PROVIDER: 'deepseek',
        LLM_ENDPOINT: MOCK_URL,
        LLM_MODEL: 'cdp-p0-api',
        LLM_TIMEOUT_MS: '10000',
        DEEPSEEK_API_KEY: 'cdp-test-key',
        HEFENG_API_HOST: 'mock.weather.local',
        HEFENG_API_KEY: 'mock-weather-key',
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${WEATHER_MOCK}`.trim(),
      },
    })
    await waitForHttp(`${sqliteUrl}/conversations`)
    return server
  }

  let sqliteServer = await startSqliteServer()
  let createdSqliteId = null

  try {
    const migratedList = await fetchJson(`${sqliteUrl}/conversations`)
    assert(
      migratedList.data.conversations.some((item) => item.id === fileSeed.id) &&
        migratedList.data.conversations.some((item) => item.id === legacySeed.id),
      'P0-36 sqlite migration did not import JSON conversations'
    )

    const legacyDetail = await fetchJson(`${sqliteUrl}/conversations/${legacySeed.id}`)
    assert(
      legacyDetail.data.conversation.messages[0].reasoningContent === 'legacy reasoning',
      'P0-36 sqlite migration did not preserve assistant reasoning fields'
    )

    const created = await fetchJson(`${sqliteUrl}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '新的聊天' }),
    })
    createdSqliteId = created.data.conversation.id
    const answer = await askDirect(sqliteUrl, createdSqliteId, 'P0_SQLITE_APPEND 请保存到 sqlite')
    assert(answer.protocol === '2' && answer.text.includes('标准回答'), 'P0-37 sqlite ask flow failed')

    const afterAsk = await fetchJson(`${sqliteUrl}/conversations/${createdSqliteId}`)
    assert(afterAsk.data.conversation.messages.length === 2, 'P0-37 sqlite ask messages were not persisted')
    assert(
      afterAsk.data.conversation.title.startsWith('P0_SQLITE_APPEND'),
      'P0-37 sqlite title was not generated from first user message'
    )

    const renamed = await fetchJson(`${sqliteUrl}/conversations/${createdSqliteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'SQLite renamed' }),
    })
    assert(renamed.data.conversation.title === 'SQLite renamed', 'P0-38 sqlite rename failed')

    const cleared = await fetchJson(`${sqliteUrl}/conversations/${createdSqliteId}/clear`, { method: 'POST' })
    assert(cleared.data.conversation.messages.length === 0, 'P0-38 sqlite clear failed')

    await stopProcess(sqliteServer)
    sqliteServer = null

    const db = new DatabaseSync(sqliteDbPath)
    try {
      const marker = db.prepare('SELECT value FROM storage_meta WHERE key = ?').get('json_migration_completed')
      const importedCount = db.prepare('SELECT value FROM storage_meta WHERE key = ?').get('json_migration_imported_count')
      assert(marker?.value === '1' && importedCount?.value === '2', 'P0-36 sqlite migration metadata missing')
    } finally {
      db.close()
    }

    sqliteServer = await startSqliteServer()
    const restartedList = await fetchJson(`${sqliteUrl}/conversations`)
    assert(
      restartedList.data.conversations.filter((item) => item.id === fileSeed.id).length === 1 &&
        restartedList.data.conversations.filter((item) => item.id === legacySeed.id).length === 1,
      'P0-36 sqlite migration was not idempotent after restart'
    )
    assert(
      restartedList.data.conversations.some((item) => item.id === createdSqliteId),
      'P0-37 sqlite conversation did not persist after restart'
    )

    const deleted = await fetchJson(`${sqliteUrl}/conversations/${createdSqliteId}`, { method: 'DELETE' })
    assert(deleted.status === 204, 'P0-38 sqlite delete failed')

    return {
      dbPath: sqliteDbPath,
      migratedIds: [fileSeed.id, legacySeed.id],
      createdSqliteId,
    }
  } finally {
    if (createdSqliteId) {
      await fetch(`${sqliteUrl}/conversations/${encodeURIComponent(createdSqliteId)}`, { method: 'DELETE' }).catch(() => {})
    }
    await stopProcess(sqliteServer)
    await rm(sqliteDataDir, { recursive: true, force: true })
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const mock = createMockLlmServer()
  await mock.start()
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-p0-data-'))
  const conversationsDir = path.join(dataDir, 'file', 'conversations')

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
      CONVERSATION_STORE: 'file',
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

    const blankAsk = await askWithRequestId(client, crudId, '   ', 'blank-question-request')
    assert(blankAsk.status === 400 && blankAsk.data.message === '问题不能为空', 'P0-40 blank question validation failed')

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
    const toolLongPreamble = await ask(client, toolId, 'P0_TOOL_LONG_PREAMBLE 工具调用前输出超过缓冲阈值的文字')
    const toollessStream = await askStreamEvents(client, toolId, 'P0_TOOLLESS_STREAM 普通回答需要持续流式输出')
    const toolFailure = await ask(client, toolId, 'P0_TOOL_FAILURE 查询异常城今天天气')
    const toolUnknown = await ask(client, toolId, 'P0_TOOL_UNKNOWN 调用不存在工具')
    await ask(client, toolId, 'P0_TOOL_CONTEXT_MEMORY P0_TOOL_CONTEXT_CITY_BEIJING 请记住我的城市是北京')
    const toolContext = await ask(client, toolId, 'P0_TOOL_CONTEXT_QUERY 请按刚才记住的城市查询明天天气')
    assert(toolSuccess.text.includes('北京明天天气'), 'P0-14 tool success failed')
    assert(toolSuccess.protocol === '2', 'P0-26 stream protocol header missing')
    assert(toolReasoning.text.includes('reasoning 已回传'), 'P0-14 tool reasoning_content was not passed back')
    assert(
      toolPreamble.text.includes('北京明天天气') && !toolPreamble.text.includes('我先看一下天气'),
      'P0-14 tool preamble leaked before tool result answer'
    )
    assert(
      toolLongPreamble.text.includes('北京明天天气') && !toolLongPreamble.text.includes('LONG_PREAMBLE_MARKER'),
      'P0-35 long tool preamble leaked before tool result answer'
    )
    const toollessDeltaEvents = toollessStream.events.filter((event) => event.type === 'delta')
    const toollessReasoningEvents = toollessStream.events.filter((event) => event.type === 'reasoning_delta')
    const toollessDoneEvent = toollessStream.events.find((event) => event.type === 'done')
    assert(toollessStream.protocol === '2', 'P0-39 stream protocol header missing')
    assert(toollessReasoningEvents.length >= 1, 'P0-39 reasoning delta was not streamed')
    assert(toollessDeltaEvents.length >= 2, 'P0-39 ordinary answer was buffered instead of streamed')
    assert(toollessDoneEvent && toollessDeltaEvents[0].atMs < toollessDoneEvent.atMs, 'P0-39 first delta did not arrive before done')
    assert(
      toollessDeltaEvents.map((event) => event.content || '').join('').includes('普通流式回答结束'),
      'P0-39 streamed ordinary answer content missing'
    )
    assert(toolFailure.text.includes('天气服务暂时不可用'), 'P0-15 tool failure fallback failed')
    assert(toolUnknown.text.includes('未找到相关工具'), 'P0-16 unknown tool fallback failed')
    assert(toolContext.text.includes('上下文城市工具调用成功'), 'P0-27 tool decision did not use conversation context')
    const toolDetail = await api(client, `/conversations/${toolId}`)
    const reasoningMessage = toolDetail.data.conversation.messages.find(
      (message) =>
        message.role === 'assistant' &&
        message.content.includes('reasoning 已回传')
    )
    assert(
      reasoningMessage?.reasoningContent === '需要先调用天气工具。',
      'P0-28 assistant reasoning content was not persisted'
    )
    assert(
      typeof reasoningMessage?.reasoningDurationMs === 'number' && reasoningMessage.reasoningDurationMs >= 0,
      'P0-28 assistant reasoning duration was not persisted'
    )
    const successfulToolMessage = toolDetail.data.conversation.messages.find(
      (message) => message.role === 'assistant' && message.content.includes('北京明天天气：晴，')
    )
    assert(successfulToolMessage?.status === 'completed', 'R12 completed status was not persisted')
    assert(
      successfulToolMessage?.generation?.provider === 'deepseek' &&
      successfulToolMessage?.generation?.model === 'cdp-p0-api' &&
      successfulToolMessage?.generation?.finishReason === 'stop' &&
      successfulToolMessage?.generation?.usage?.totalTokens === 26,
      'R12 generation metadata or aggregated usage was not persisted'
    )
    assert(
      successfulToolMessage?.toolTrace?.[0]?.name === 'getWeather' &&
      successfulToolMessage?.toolTrace?.[0]?.success === true &&
      typeof successfulToolMessage?.toolTrace?.[0]?.durationMs === 'number' &&
      !JSON.stringify(successfulToolMessage.toolTrace).includes('city'),
      'R12 trimmed tool trace was not persisted safely'
    )

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
    assert(answerStopDetail.data.conversation.messages.length === 2, 'P0-24 stopped answer-stage body was not persisted')
    assert(
      answerStopDetail.data.conversation.messages[1]?.status === 'stopped' &&
      answerStopDetail.data.conversation.messages[1]?.content.includes('answer-stage-1') &&
      answerStopDetail.data.conversation.messages[1]?.generation?.usage === undefined &&
      answerStopDetail.data.conversation.messages[1]?.toolTrace?.[0]?.name === 'getWeather',
      'P0-24 stopped answer metadata was not preserved safely'
    )

    const badFunctionJson = await ask(client, toolId, 'P0_BAD_FUNCTION_JSON 触发非法函数 JSON')
    const beforeIncompleteDetail = await api(client, `/conversations/${toolId}`)
    const incompleteStream = await ask(client, toolId, 'P0_INCOMPLETE_STREAM 触发上游异常 EOF')
    const afterIncompleteDetail = await api(client, `/conversations/${toolId}`)
    const malformedStream = await ask(client, toolId, 'P0_MALFORMED_STREAM 触发损坏流')
    const emptyModel = await ask(client, toolId, 'P0_EMPTY_MODEL 触发空模型响应')
    const recovery = await ask(client, toolId, 'P0_RECOVERY 确认异常后还能继续')
    assert(badFunctionJson.text.includes('标准回答') && badFunctionJson.text.includes('"type":"done"'), 'P0-20 invalid function JSON did not fallback to standard answer')
    assert(
      incompleteStream.text.includes('"type":"delta"') &&
      incompleteStream.text.includes('incomplete partial output') &&
      incompleteStream.text.includes('"type":"error"') &&
      incompleteStream.text.includes('上游模型响应未完整结束') &&
      !incompleteStream.text.includes('"type":"done"'),
      'P0-21 incomplete provider stream did not preserve partial output and return only a stream error'
    )
    assert(
      afterIncompleteDetail.data.conversation.messages.length ===
        beforeIncompleteDetail.data.conversation.messages.length,
      'P0-21 incomplete provider stream was persisted'
    )
    assert(malformedStream.text.includes('"type":"error"'), 'P0-22 malformed stream did not return stream error')
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
        CONVERSATION_STORE: 'file',
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
      assert(
        await fileExists(path.join(legacyDataDir, 'file', 'conversations', 'conv_legacy_cdp.json')),
        'P1-29 legacy conversation was not migrated into file store folder'
      )
      assert(await fileExists(path.join(legacyDataDir, 'conversations.json.migrated')), 'P1-29 legacy migrated marker missing')
      const legacyListAgain = await (await fetch('http://127.0.0.1:7703/conversations')).json()
      assert(legacyListAgain.conversations.filter((item) => item.id === 'conv_legacy_cdp').length === 1, 'P1-30 legacy migration was repeated')
    } finally {
      await stopProcess(legacyServer)
      await rm(legacyDataDir, { recursive: true, force: true })
    }

    const corruptDataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-corrupt-data-'))
    const corruptConversationsDir = path.join(corruptDataDir, 'file', 'conversations')
    const corruptFilePath = path.join(corruptConversationsDir, 'conv_corrupt_cdp.json')
    const validFilePath = path.join(corruptConversationsDir, 'conv_valid_cdp.json')
    const corruptTimestamp = new Date().toISOString()
    await mkdir(corruptConversationsDir, { recursive: true })
    await writeFile(corruptFilePath, '{broken json', 'utf8')
    await writeFile(validFilePath, JSON.stringify({
      id: 'conv_valid_cdp',
      title: 'Valid beside corrupt file',
      createdAt: corruptTimestamp,
      updatedAt: corruptTimestamp,
      titleManuallyEdited: true,
      messages: [],
    }), 'utf8')
    const corruptServer = spawnProcess('node', ['./bin/www.ts'], {
      cwd: path.resolve(process.cwd(), 'server'),
      env: {
        ...process.env,
        PORT: '7704',
        CONVERSATION_STORE: 'file',
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
      const corruptJson = await corruptResponse.json()
      assert(corruptResponse.status === 200, 'P1-31 corrupt JSON made the list unavailable')
      assert(
        corruptJson.conversations.some((item) => item.id === 'conv_valid_cdp'),
        'P1-31 valid conversation beside corrupt JSON was not returned'
      )
      assert(
        !corruptJson.conversations.some((item) => item.id === 'conv_corrupt_cdp'),
        'P1-31 corrupt conversation unexpectedly entered the list'
      )
      assert(await fileExists(corruptFilePath), 'P1-31 corrupt source file was destructively removed')
    } finally {
      await stopProcess(corruptServer)
      await rm(corruptDataDir, { recursive: true, force: true })
    }

    const sqliteStorage = await runSqliteStorageScenario()

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
        'P0-26': 'passed',
        'P0-27': 'passed',
        'P0-28': 'passed',
        'P0-35': 'passed',
        'P0-39': 'passed',
        'P0-40': 'passed',
        'P0-36': 'passed',
        'P0-37': 'passed',
        'P0-38': 'passed',
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
      toolLongPreamble: toolLongPreamble.text,
      toollessStream: {
        eventCount: toollessStream.events.length,
        deltaCount: toollessDeltaEvents.length,
        firstDeltaAtMs: toollessDeltaEvents[0]?.atMs,
        doneAtMs: toollessDoneEvent?.atMs,
      },
      toolFailure: toolFailure.text,
      toolUnknown: toolUnknown.text,
      toolContext: toolContext.text,
      reasoningMessage,
      stopped,
      answerStopped,
      sqliteStorage,
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
    await rm(profileDir, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
