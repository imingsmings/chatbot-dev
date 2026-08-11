import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import https from 'node:https'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO_ROOT = process.cwd()
const PROJECT_NAME = `chatbot-docker-test-${process.pid}`
const TIMEOUT_MS = 120_000
const COMMAND_TIMEOUT_MS = 300_000
const CLEANUP_TIMEOUT_MS = 30_000

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let timedOut = false
    let forceKillTimer
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
      forceKillTimer.unref()
    }, options.timeoutMs ?? COMMAND_TIMEOUT_MS)
    timeoutTimer.unref()
    const clearTimers = () => {
      clearTimeout(timeoutTimer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
    }
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.once('error', (error) => {
      clearTimers()
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimers()
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }
      if (timedOut) {
        reject(new Error(`${command} ${args.join(' ')} timed out\n${result.stdout}${result.stderr}`))
        return
      }
      if (code === 0 || options.allowFailure) {
        resolve(result)
        return
      }
      reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${result.stdout}${result.stderr}`))
    })
  })
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      assert(address && typeof address !== 'string')
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    const req = https.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: options.method ?? 'GET',
      rejectUnauthorized: false,
      headers: {
        Accept: options.accept ?? 'application/json',
        ...(body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            }
          : {}),
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.once('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function waitForHealthy(containerId) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const result = await run('docker', [
      'inspect',
      '--format',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
      containerId,
    ], { allowFailure: true })
    const status = result.stdout.trim()
    if (status === 'healthy') return
    if (status === 'unhealthy' || status === 'exited') {
      throw new Error(`Container became ${status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Timed out waiting for a healthy container')
}

async function main() {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'chatbot-docker-smoke-'))
  const dockerConfigDir = path.join(tempDir, 'docker-config')
  const envFile = path.join(tempDir, 'server.env')
  const port = await findAvailablePort()
  await mkdir(dockerConfigDir)
  await writeFile(path.join(dockerConfigDir, 'config.json'), JSON.stringify({
    auths: {},
    cliPluginsExtraDirs: ['/Applications/Docker.app/Contents/Resources/cli-plugins'],
  }))
  const composeEnv = {
    ...process.env,
    CHATBOT_ENV_FILE: envFile,
    CHATBOT_HTTPS_PORT: String(port),
    DOCKER_CONFIG: dockerConfigDir,
  }
  const compose = (...args) => run('docker', ['compose', '-p', PROJECT_NAME, ...args], { env: composeEnv })
  let containerId = ''
  let conversationId = ''

  await writeFile(envFile, [
    'LLM_PROVIDER=deepseek',
    'DEEPSEEK_ENDPOINT=https://mock.invalid/chat/completions',
    'DEEPSEEK_MODEL=deepseek-v4-flash',
    'DEEPSEEK_API_KEY=docker-smoke-test-key',
    'LLM_DISABLED_MODELS=deepseek-v4-pro,gpt-5.6-sol',
    'CONVERSATION_STORE=sqlite',
    'APP_PROFILE_NAME=Docker Smoke Test',
    '',
  ].join('\n'))

  try {
    await compose('config', '--quiet')
    await compose('up', '-d', '--build')
    containerId = (await compose('ps', '-q', 'chatbot')).stdout.trim()
    assert(containerId, 'Compose did not return the chatbot container id')
    await waitForHealthy(containerId)
    const processList = (await run('docker', [
      'top',
      containerId,
      '-eo',
      'pid,user,args',
    ])).stdout.trim()
    assert.match(processList, /^\s*\d+\s+(?:1000|node)\s+node server\/bin\/www\.ts$/m)

    const home = await request(port, '/', { accept: 'text/html' })
    assert.equal(home.status, 200)
    assert.match(home.text, /<div id="root"><\/div>/)
    assert.equal(home.headers['cache-control'], 'no-cache')

    const runtime = await request(port, '/api/runtime-config')
    assert.equal(runtime.status, 200)
    const runtimePayload = JSON.parse(runtime.text)
    assert.equal(runtimePayload.runtime.provider, 'deepseek')
    assert.equal(runtimePayload.runtime.model, 'deepseek-v4-flash')
    assert.equal(runtimePayload.runtime.storageBackend, 'sqlite')

    const missingApi = await request(port, '/api/not-a-route', { accept: 'text/html' })
    assert.equal(missingApi.status, 404)
    assert.deepEqual(JSON.parse(missingApi.text), { message: 'Not Found' })

    const created = await request(port, '/api/conversations', {
      method: 'POST',
      body: { title: `Docker smoke ${Date.now()}` },
    })
    assert.equal(created.status, 201)
    conversationId = JSON.parse(created.text).conversation.id
    assert.match(conversationId, /^conv_/)

    await compose('restart', 'chatbot')
    await waitForHealthy(containerId)
    const persisted = await request(port, `/api/conversations/${conversationId}`)
    assert.equal(persisted.status, 200)
    assert.equal(JSON.parse(persisted.text).conversation.id, conversationId)

    await compose('stop', '--timeout', '15', 'chatbot')
    const exitCode = (await run('docker', [
      'inspect',
      '--format',
      '{{.State.ExitCode}}',
      containerId,
    ])).stdout.trim()
    assert.equal(exitCode, '0')
    const logs = (await compose('logs', '--no-color', 'chatbot')).stdout
    assert.match(logs, /收到 SIGTERM，正在停止服务/)
    assert.match(logs, /服务已停止/)

    console.log(JSON.stringify({
      ok: true,
      project: PROJECT_NAME,
      image: 'chatbot:local',
      httpsPort: port,
      assertions: [
        'compose config valid',
        'image built and container healthy',
        'application process runs as non-root node user',
        'React build served over HTTPS',
        'runtime config and JSON 404 valid',
        'SQLite conversation persisted across restart',
        'SIGTERM shutdown exited with code 0',
      ],
    }, null, 2))
  } finally {
    await run('docker', ['compose', '-p', PROJECT_NAME, 'down', '-v', '--remove-orphans'], {
      env: composeEnv,
      allowFailure: true,
      timeoutMs: CLEANUP_TIMEOUT_MS,
    }).catch(() => undefined)
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
