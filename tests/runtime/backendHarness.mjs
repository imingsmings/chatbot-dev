import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate a TCP port'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForHttp(url, timeoutMs = 15_000) {
  const startedAt = performance.now()
  while (performance.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return performance.now() - startedAt
    } catch {
      // The process may still be binding its listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', handleExit)
      resolve(false)
    }, timeoutMs)
    const handleExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', handleExit)
  })
}

async function stopBackend(handle) {
  const child = handle?.child
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  if (!(await waitForExit(child, 5_000))) {
    child.kill('SIGKILL')
    await waitForExit(child, 2_000)
  }
}

async function startBackend({
  runtime,
  directory,
  repoRoot,
  port,
  dataDir,
  providerUrl,
  store = 'file',
}) {
  const output = []
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    AUTH_ENABLED: 'false',
    HTTPS_ENABLED: 'false',
    SERVE_CLIENT_BUILD: 'false',
    HOST: '127.0.0.1',
    PORT: String(port),
    CONVERSATION_STORE: store,
    CONVERSATION_DATA_DIR: dataDir,
    LLM_PROVIDER: 'deepseek',
    LLM_ENDPOINT: providerUrl,
    LLM_MODEL: 'deepseek-v4-flash',
    DEEPSEEK_API_KEY: 'runtime-test-key',
    LLM_TIMEOUT_MS: '10000',
    DOTENV_CONFIG_PATH: '/dev/null',
    DOTENV_CONFIG_QUIET: 'true',
  }
  const startedAt = performance.now()
  const child = spawn(runtime, ['./bin/www.ts'], {
    cwd: path.join(repoRoot, directory),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => output.push(Buffer.from(chunk)))
  child.stderr.on('data', (chunk) => output.push(Buffer.from(chunk)))

  let handleEarlyExit
  const earlyExit = new Promise((_, reject) => {
    handleEarlyExit = (code, signal) => {
      reject(new Error(`${runtime} backend exited before readiness (${code ?? signal})`))
    }
    child.once('exit', handleEarlyExit)
  })

  try {
    await Promise.race([
      waitForHttp(`http://127.0.0.1:${port}/api/health/live`),
      earlyExit,
    ])
  } catch (error) {
    await stopBackend({ child })
    const detail = Buffer.concat(output).toString('utf8')
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${detail}`)
  } finally {
    child.off('exit', handleEarlyExit)
  }

  return {
    child,
    origin: `http://127.0.0.1:${port}`,
    readyMs: performance.now() - startedAt,
    getOutput: () => Buffer.concat(output).toString('utf8'),
  }
}

async function startMockProvider() {
  const port = await findAvailablePort()
  let callCount = 0
  const requests = []
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.writeHead(404).end()
      return
    }

    const chunks = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    callCount += 1
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end([
      'data: {"choices":[{"delta":{"content":"Bun parity answer"}}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
      '',
    ].join('\n'))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })

  return {
    url: `http://127.0.0.1:${port}/chat/completions`,
    get callCount() {
      return callCount
    },
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

export {
  findAvailablePort,
  startBackend,
  startMockProvider,
  stopBackend,
  waitForHttp,
}
