import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashPassword } from '../../bun-server/security/password.ts'

const REPO_ROOT = process.cwd()
const PROJECT_NAME = `chatbot-docker-test-${process.pid}`
const TIMEOUT_MS = 120_000
const COMMAND_TIMEOUT_MS = 300_000
const CLEANUP_TIMEOUT_MS = 30_000
const MAX_RUNTIME_IMAGE_SIZE_BYTES = 300_000_000
let bearerToken = ''

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZP4sAAAAASUVORK5CYII=',
  'base64',
)

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
    const body = options.rawBody === undefined
      ? options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body))
      : Buffer.from(options.rawBody)
    const jsonBody = options.rawBody === undefined && options.body !== undefined
    const req = https.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: options.method ?? 'GET',
      rejectUnauthorized: false,
      headers: {
        Accept: options.accept ?? 'application/json',
        ...(bearerToken && options.auth !== false
          ? { Authorization: `Bearer ${bearerToken}` }
          : {}),
        ...(body !== undefined
          ? {
              ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
              'Content-Length': body.byteLength,
            }
          : {}),
        ...(options.headers ?? {}),
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const buffer = Buffer.concat(chunks)
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          buffer,
          text: buffer.toString('utf8'),
        })
      })
    })
    req.once('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function createMultipartImageBody(image, filename = 'docker-vision.png') {
  const boundary = `----chatbot-docker-${randomBytes(12).toString('hex')}`
  const body = Buffer.concat([
    Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="image"; filename="${filename}"`,
      'Content-Type: image/png',
      '',
      '',
    ].join('\r\n')),
    image,
    Buffer.from([
      '',
      `--${boundary}`,
      'Content-Disposition: form-data; name="detail"',
      '',
      'low',
      `--${boundary}--`,
      '',
    ].join('\r\n')),
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

async function normalizeDockerDesktopBindSource(source) {
  const hostPath = source.startsWith('/host_mnt/') ? source.slice('/host_mnt'.length) : source
  return realpath(hostPath)
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
  const certificatePath = path.join(tempDir, 'server-cert.pem')
  const privateKeyPath = path.join(tempDir, 'server-key.pem')
  const opensslConfigPath = path.join(tempDir, 'openssl.cnf')
  const backupDir = path.join(tempDir, 'backup')
  const port = await findAvailablePort()
  let providerPort = await findAvailablePort()
  while (providerPort === port) {
    providerPort = await findAvailablePort()
  }
  await mkdir(dockerConfigDir)
  await writeFile(path.join(dockerConfigDir, 'config.json'), JSON.stringify({
    auths: {},
    cliPluginsExtraDirs: ['/Applications/Docker.app/Contents/Resources/cli-plugins'],
  }))
  const composeEnv = {
    ...process.env,
    CHATBOT_ENV_FILE: envFile,
    CHATBOT_HTTPS_PORT: String(port),
    CHATBOT_TLS_CERT_SOURCE: certificatePath,
    CHATBOT_TLS_KEY_SOURCE: privateKeyPath,
    DOCKER_CONFIG: dockerConfigDir,
  }
  const compose = (...args) => run('docker', ['compose', '-p', PROJECT_NAME, ...args], {
    env: composeEnv,
  })
  const composeWithRestoredVolume = (volumeName, ...args) => run('docker', [
    'compose',
    '-p',
    PROJECT_NAME,
    '-f',
    'compose.yaml',
    '-f',
    'compose.data-volume.yaml',
    ...args,
  ], {
    env: {
      ...composeEnv,
      CHATBOT_DATA_VOLUME: volumeName,
    },
  })
  let containerId = ''
  let conversationId = ''
  let sourceVolume = ''
  let runtimeImageSizeBytes = 0
  let mockProvider
  let providerCallCount = 0
  const providerRequestBodies = []
  const restoredVolume = `${PROJECT_NAME}-restored`
  const rejectedVolume = `${PROJECT_NAME}-rejected`
  const authUsername = 'docker-smoke-user'
  const authPassword = `docker-smoke-password-${process.pid}`
  const authPasswordHash = await hashPassword(authPassword)
  let refreshCookie = ''
  const imageSha256 = createHash('sha256').update(PNG_1X1).digest('hex')

  await writeFile(envFile, [
    'LLM_PROVIDER=deepseek',
    `DEEPSEEK_ENDPOINT=http://host.docker.internal:${providerPort}/chat/completions`,
    'DEEPSEEK_MODEL=deepseek-v4-flash',
    'DEEPSEEK_API_KEY=docker-smoke-test-key',
    'LLM_DISABLED_MODELS=deepseek-v4-pro,gpt-5.6-sol',
    'CONVERSATION_STORE=sqlite',
    'APP_PROFILE_NAME=Docker Smoke Test',
    'AUTH_ENABLED=true',
    `AUTH_USERNAME=${authUsername}`,
    `AUTH_PASSWORD_HASH='${authPasswordHash}'`,
    `AUTH_ACCESS_TOKEN_SECRET=${randomBytes(32).toString('base64url')}`,
    `AUTH_REFRESH_TOKEN_SECRET=${randomBytes(32).toString('base64url')}`,
    `AUTH_ALLOWED_ORIGINS=https://127.0.0.1:${port}`,
    '',
  ].join('\n'))
  await writeFile(opensslConfigPath, [
    '[req]',
    'distinguished_name=dn',
    'x509_extensions=v3',
    'prompt=no',
    '[dn]',
    'CN=localhost',
    '[v3]',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '',
  ].join('\n'))
  await run('openssl', [
    'req',
    '-x509',
    '-nodes',
    '-newkey',
    'rsa:2048',
    '-days',
    '1',
    '-keyout',
    privateKeyPath,
    '-out',
    certificatePath,
    '-config',
    opensslConfigPath,
  ])

  mockProvider = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        providerCallCount += 1
        providerRequestBodies.push(body)
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end([
          'data: {"choices":[{"delta":{"content":"Docker 图片回答"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ].join(''))
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'bad request' } }))
      }
    })
  })
  await new Promise((resolve, reject) => {
    mockProvider.once('error', reject)
    mockProvider.listen(providerPort, '0.0.0.0', resolve)
  })

  try {
    const defaultComposeEnv = { ...composeEnv }
    delete defaultComposeEnv.CHATBOT_TLS_CERT_SOURCE
    delete defaultComposeEnv.CHATBOT_TLS_KEY_SOURCE
    await run('docker', ['compose', '-p', `${PROJECT_NAME}-default-config`, 'config', '--quiet'], {
      env: defaultComposeEnv,
    })
    await compose('config', '--quiet')
    await compose('up', '-d', '--build')
    containerId = (await compose('ps', '-q', 'chatbot')).stdout.trim()
    assert(containerId, 'Compose did not return the chatbot container id')
    await waitForHealthy(containerId)
    runtimeImageSizeBytes = Number((await run('docker', [
      'image',
      'inspect',
      'chatbot:local',
      '--format',
      '{{.Size}}',
    ])).stdout.trim())
    assert(Number.isSafeInteger(runtimeImageSizeBytes) && runtimeImageSizeBytes > 0)
    assert(
      runtimeImageSizeBytes < MAX_RUNTIME_IMAGE_SIZE_BYTES,
      `Runtime image is too large: ${runtimeImageSizeBytes} bytes`,
    )
    const runtimeDetails = await run('docker', [
      'exec', '--user', 'root', containerId, 'sh', '-lc',
      [
        'test "$(bun --version)" = "1.4.0"',
        'test ! -e /root/.cache/pnpm',
        'test ! -e /root/.cache/node/corepack/v1/pnpm',
        'test ! -e /root/.bun/install/cache',
        'test ! -e /app/client/node_modules',
        'test ! -e /app/tests',
        'test ! -e /app/pnpm-lock.yaml',
        'test ! -e /app/pnpm-workspace.yaml',
        'test ! -e /app/bun-server/node_modules/typescript',
        'printf "runtime=%s uid=%s\\n" "$(bun --version)" "$(id -u bun)"',
      ].join(' && '),
    ])
    assert.match(runtimeDetails.stdout, /runtime=1\.4\.0 uid=1000/)
    const processList = (await run('docker', [
      'top',
      containerId,
      '-eo',
      'pid,user,args',
    ])).stdout.trim()
    assert.match(processList, /^\s*\d+\s+(?:1000|bun)\s+bun bun-server\/bin\/www\.ts$/m)

    const missingAuthConfig = await run('docker', [
      'run', '--rm',
      '--volume', `${certificatePath}:/run/tls/server-cert.pem:ro`,
      '--volume', `${privateKeyPath}:/run/tls/server-key.pem:ro`,
      '--env', 'NODE_ENV=production',
      '--env', 'LLM_PROVIDER=deepseek',
      '--env', 'LLM_ENDPOINT=https://provider.invalid/v1',
      '--env', 'DEEPSEEK_API_KEY=docker-smoke-key',
      '--env', 'AUTH_ENABLED=true',
      '--env', `AUTH_USERNAME=${authUsername}`,
      '--env', `AUTH_PASSWORD_HASH=${authPasswordHash}`,
      '--env', `AUTH_ACCESS_TOKEN_SECRET=${randomBytes(32).toString('base64url')}`,
      'chatbot:local',
    ], { allowFailure: true })
    assert.notEqual(missingAuthConfig.code, 0)
    assert.match(missingAuthConfig.stderr, /AUTH_REFRESH_TOKEN_SECRET/)

    const containerMounts = JSON.parse((await run('docker', [
      'inspect',
      '--format',
      '{{json .Mounts}}',
      containerId,
    ])).stdout)
    assert.equal(await normalizeDockerDesktopBindSource(
      containerMounts.find((mount) => mount.Destination === '/run/tls/server-cert.pem')?.Source ?? '',
    ), await realpath(certificatePath))
    assert.equal(await normalizeDockerDesktopBindSource(
      containerMounts.find((mount) => mount.Destination === '/run/tls/server-key.pem')?.Source ?? '',
    ), await realpath(privateKeyPath))
    sourceVolume = containerMounts.find((mount) => mount.Destination === '/app/data')?.Name ?? ''
    assert(sourceVolume, 'Container did not mount a named volume at /app/data')

    const home = await request(port, '/', { accept: 'text/html' })
    assert.equal(home.status, 200)
    assert.match(home.text, /<div id="root"><\/div>/)
    assert.equal(home.headers['cache-control'], 'no-cache')

    const authStatus = await request(port, '/api/auth/status', { auth: false })
    assert.equal(authStatus.status, 200)
    assert.deepEqual(JSON.parse(authStatus.text), { enabled: true })
    const unauthenticatedRuntime = await request(port, '/api/runtime-config', { auth: false })
    assert.equal(unauthenticatedRuntime.status, 401)

    const login = await request(port, '/api/auth/login', {
      auth: false,
      method: 'POST',
      headers: { Origin: `https://127.0.0.1:${port}` },
      body: { username: authUsername, password: authPassword },
    })
    assert.equal(login.status, 200)
    bearerToken = JSON.parse(login.text).accessToken
    assert(bearerToken)
    refreshCookie = String(login.headers['set-cookie']).split(';')[0]
    assert.match(refreshCookie, /^chatbot_refresh=/)
    assert.match(String(login.headers['set-cookie']), /HttpOnly/i)
    assert.match(String(login.headers['set-cookie']), /Secure/i)
    assert.match(String(login.headers['set-cookie']), /SameSite=Strict/i)

    const runtime = await request(port, '/api/runtime-config')
    assert.equal(runtime.status, 200)
    const runtimePayload = JSON.parse(runtime.text)
    assert.equal(runtimePayload.runtime.provider, 'deepseek')
    assert.equal(runtimePayload.runtime.model, 'deepseek-v4-flash')
    assert.equal(runtimePayload.runtime.storageBackend, 'sqlite')

    const health = await request(port, '/api/health')
    const readiness = await request(port, '/api/health/ready')
    const liveness = await request(port, '/api/health/live')
    assert.equal(health.status, 200)
    assert.equal(readiness.status, 200)
    assert.deepEqual(JSON.parse(health.text), {
      status: 'ok',
      checks: { configuration: 'ok', storage: 'ok' },
    })
    assert.deepEqual(JSON.parse(readiness.text), JSON.parse(health.text))
    assert.equal(liveness.status, 200)
    assert.deepEqual(JSON.parse(liveness.text), { status: 'ok' })

    await run('docker', ['exec', '--user', 'root', containerId, 'chmod', '0555', '/app/data/sqlite'])
    await run('docker', [
      'exec', '--user', 'root', containerId,
      'chmod', '0444', '/app/data/sqlite/conversations.sqlite3',
    ])
    const unwritableHealth = await request(port, '/api/health/ready')
    const unwritableLiveness = await request(port, '/api/health/live')
    assert.equal(unwritableHealth.status, 503)
    assert.deepEqual(JSON.parse(unwritableHealth.text), {
      status: 'unhealthy',
      checks: { configuration: 'ok', storage: 'error' },
    })
    assert.equal(unwritableLiveness.status, 200)
    assert.deepEqual(JSON.parse(unwritableLiveness.text), { status: 'ok' })
    await run('docker', [
      'exec', '--user', 'root', containerId,
      'chmod', '0644', '/app/data/sqlite/conversations.sqlite3',
    ])
    await run('docker', ['exec', '--user', 'root', containerId, 'chmod', '0755', '/app/data/sqlite'])
    const recoveredHealth = await request(port, '/api/health/ready')
    assert.equal(recoveredHealth.status, 200)

    const missingApi = await request(port, '/api/not-a-route', { accept: 'text/html' })
    assert.equal(missingApi.status, 404)
    assert.deepEqual(JSON.parse(missingApi.text), { message: 'Not Found' })

    const created = await request(port, '/api/conversations', {
      method: 'POST',
      body: { title: `Docker smoke ${Date.now()}` },
    })
    assert.equal(created.status, 201)
    const createdConversation = JSON.parse(created.text).conversation
    conversationId = createdConversation.id
    assert.match(conversationId, /^conv_/)
    assert.deepEqual(createdConversation.modelOptions, {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEnabled: true,
      reasoningEffort: 'max',
    })
    const persistedModelOptions = {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEnabled: true,
      reasoningEffort: 'low',
      temperature: 0.2,
      maxTokens: 2048,
    }
    const modelOptionsUpdate = await request(
      port,
      `/api/conversations/${conversationId}/model-options`,
      { method: 'PATCH', body: { options: persistedModelOptions } },
    )
    assert.equal(modelOptionsUpdate.status, 200)
    assert.deepEqual(JSON.parse(modelOptionsUpdate.text).conversation.modelOptions, persistedModelOptions)
    assert.equal(JSON.parse(modelOptionsUpdate.text).conversation.updatedAt, createdConversation.updatedAt)

    const visionCreated = await request(port, '/api/conversations', {
      method: 'POST',
      body: { title: `Docker vision recovery ${Date.now()}` },
    })
    assert.equal(visionCreated.status, 201)
    const visionConversationId = JSON.parse(visionCreated.text).conversation.id
    const visionModelOptions = {
      provider: 'deepseek',
      model: 'deepseek-v4-flash-vision-exp',
      reasoningEnabled: false,
      reasoningEffort: 'max',
    }
    const visionOptionsUpdate = await request(
      port,
      `/api/conversations/${visionConversationId}/model-options`,
      { method: 'PATCH', body: { options: visionModelOptions } },
    )
    assert.equal(visionOptionsUpdate.status, 200)
    const multipart = createMultipartImageBody(PNG_1X1)
    const uploaded = await request(port, `/api/conversations/${visionConversationId}/attachments`, {
      method: 'POST',
      rawBody: multipart.body,
      headers: { 'Content-Type': multipart.contentType },
    })
    assert.equal(uploaded.status, 201, uploaded.text)
    const attachment = JSON.parse(uploaded.text).attachment
    assert.equal(attachment.byteSize, PNG_1X1.length)
    assert.equal(attachment.mediaType, 'image/png')
    assert.deepEqual({ width: attachment.width, height: attachment.height }, { width: 1, height: 1 })
    await run('docker', [
      'exec', containerId, 'sh', '-lc',
      `test -f /app/data/attachments/${attachment.id}.data && test -f /app/data/attachments/${attachment.id}.json`,
    ])
    const attachmentBeforeRestart = await request(
      port,
      `/api/conversations/${visionConversationId}/attachments/${attachment.id}`,
    )
    assert.equal(attachmentBeforeRestart.status, 200)
    assert.equal(createHash('sha256').update(attachmentBeforeRestart.buffer).digest('hex'), imageSha256)

    const visionRequestBody = {
      question: '描述这张 Docker 测试图片',
      requestId: `request_docker_vision_${Date.now()}`,
      attachmentIds: [attachment.id],
      options: visionModelOptions,
    }
    const visionAnswer = await request(
      port,
      `/api/conversations/${visionConversationId}/ask`,
      { method: 'POST', body: visionRequestBody },
    )
    assert.equal(visionAnswer.status, 200, visionAnswer.text)
    assert.match(visionAnswer.text, /"type":"delta"/)
    assert.match(visionAnswer.text, /"type":"done"/)
    assert.equal(providerCallCount, 1)
    assert.match(JSON.stringify(providerRequestBodies.at(-1)), /data:image\/png;base64,/)
    const visionDetailBeforeRestart = JSON.parse((await request(
      port,
      `/api/conversations/${visionConversationId}`,
    )).text).conversation
    assert.equal(visionDetailBeforeRestart.messages.length, 2)
    assert.equal(visionDetailBeforeRestart.messages[0].attachments[0].id, attachment.id)
    assert.equal(visionDetailBeforeRestart.messages[1].content, 'Docker 图片回答')

    const semanticConversationId = `conv_docker_backup_${Date.now()}`
    const semanticBackup = {
      schemaVersion: 1,
      source: 'chatbot-local',
      exportedAt: '2026-08-12T00:00:00.000Z',
      conversations: [{
        id: semanticConversationId,
        title: 'Docker backup semantic fixture',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:01:00.000Z',
        titleManuallyEdited: true,
        modelOptions: {
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          reasoningEnabled: true,
          reasoningEffort: 'medium',
          temperature: 0.4,
          maxTokens: 4096,
        },
        summary: {
          content: 'preserved summary',
          sourceMessageCount: 2,
          updatedAt: '2026-08-12T00:01:00.000Z',
        },
        messages: [
          { role: 'user', content: 'preserve this request' },
          {
            role: 'assistant',
            content: 'preserved answer',
            reasoningContent: 'preserved reasoning',
            reasoningDurationMs: 27,
            status: 'completed',
            generation: {
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              finishReason: 'stop',
              firstTokenLatencyMs: 12,
              totalDurationMs: 42,
              usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
            },
            toolTrace: [{
              name: 'calculate',
              success: true,
              durationMs: 3,
              summary: '计算结果：42',
            }],
          },
        ],
      }],
    }
    const imported = await request(port, '/api/conversations/import', {
      method: 'POST',
      body: { backup: semanticBackup },
    })
    assert.equal(imported.status, 201)

    const beforeList = JSON.parse((await request(port, '/api/conversations')).text).conversations
    const beforeDetails = Object.fromEntries(await Promise.all(beforeList.map(async (conversation) => {
      const detail = await request(port, `/api/conversations/${conversation.id}`)
      assert.equal(detail.status, 200)
      return [conversation.id, JSON.parse(detail.text).conversation]
    })))

    const runningBackupAttempt = await run('bun', [
      'scripts/docker-volume-backup.mjs',
      '--volume',
      sourceVolume,
      '--output',
      path.join(tempDir, 'running-backup-rejected'),
    ], { env: composeEnv, allowFailure: true })
    assert.notEqual(runningBackupAttempt.code, 0)
    assert.match(runningBackupAttempt.stderr, /mounted by a running container/)

    await compose('restart', 'chatbot')
    await waitForHealthy(containerId)
    const refreshAfterRestart = await request(port, '/api/auth/refresh', {
      auth: false,
      method: 'POST',
      headers: {
        Cookie: refreshCookie,
        Origin: `https://127.0.0.1:${port}`,
      },
    })
    assert.equal(refreshAfterRestart.status, 200)
    bearerToken = JSON.parse(refreshAfterRestart.text).accessToken
    refreshCookie = String(refreshAfterRestart.headers['set-cookie']).split(';')[0]
    const persisted = await request(port, `/api/conversations/${conversationId}`)
    assert.equal(persisted.status, 200)
    assert.equal(JSON.parse(persisted.text).conversation.id, conversationId)
    assert.deepEqual(JSON.parse(persisted.text).conversation.modelOptions, persistedModelOptions)
    const attachmentAfterRestart = await request(
      port,
      `/api/conversations/${visionConversationId}/attachments/${attachment.id}`,
    )
    assert.equal(attachmentAfterRestart.status, 200)
    assert.equal(createHash('sha256').update(attachmentAfterRestart.buffer).digest('hex'), imageSha256)
    const providerCallsBeforeReplay = providerCallCount
    const replayAfterRestart = await request(
      port,
      `/api/conversations/${visionConversationId}/ask`,
      { method: 'POST', body: visionRequestBody },
    )
    assert.equal(replayAfterRestart.status, 200)
    assert.equal(replayAfterRestart.text.trim(), '{"type":"done"}')
    assert.equal(providerCallCount, providerCallsBeforeReplay)
    const replayStatus = JSON.parse((await request(
      port,
      `/api/requests/${visionRequestBody.requestId}`,
    )).text).request
    assert.equal(replayStatus.status, 'completed')
    assert.equal(replayStatus.messageCount, 2)

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

    await run('bun', [
      'scripts/docker-volume-backup.mjs',
      '--volume',
      sourceVolume,
      '--output',
      backupDir,
    ], { env: composeEnv })
    const backupFiles = await readdir(backupDir)
    const manifestFile = backupFiles.find((file) => file.endsWith('.manifest.json'))
    assert(manifestFile, 'Backup manifest was not created')
    const manifestPath = path.join(backupDir, manifestFile)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.match(manifest.archive.sha256, /^[a-f0-9]{64}$/)
    assert.match(manifest.data.treeSha256, /^[a-f0-9]{64}$/)
    assert(manifest.data.entries.some((entry) => entry.path === 'sqlite/conversations.sqlite3'))
    assert(manifest.data.entries.some((entry) => entry.path === 'auth-sessions.sqlite3'))
    const attachmentDataEntry = manifest.data.entries.find(
      (entry) => entry.path === `attachments/${attachment.id}.data`,
    )
    const attachmentRecordEntry = manifest.data.entries.find(
      (entry) => entry.path === `attachments/${attachment.id}.json`,
    )
    assert.equal(attachmentDataEntry?.size, PNG_1X1.length)
    assert.equal(attachmentDataEntry?.sha256, imageSha256)
    assert.match(attachmentRecordEntry?.sha256 ?? '', /^[a-f0-9]{64}$/)

    const rejectedManifestPath = path.join(backupDir, 'rejected.manifest.json')
    await writeFile(rejectedManifestPath, JSON.stringify({
      ...manifest,
      archive: { ...manifest.archive, sha256: '0'.repeat(64) },
    }))
    const rejectedRestore = await run('bun', [
      'scripts/docker-volume-restore.mjs',
      '--manifest',
      rejectedManifestPath,
      '--volume',
      rejectedVolume,
    ], { env: composeEnv, allowFailure: true })
    assert.notEqual(rejectedRestore.code, 0)
    const rejectedInspect = await run('docker', ['volume', 'inspect', rejectedVolume], {
      env: composeEnv,
      allowFailure: true,
    })
    assert.notEqual(rejectedInspect.code, 0)

    await run('bun', [
      'scripts/docker-volume-restore.mjs',
      '--manifest',
      manifestPath,
      '--volume',
      restoredVolume,
    ], { env: composeEnv })
    const overwriteAttempt = await run('bun', [
      'scripts/docker-volume-restore.mjs',
      '--manifest',
      manifestPath,
      '--volume',
      restoredVolume,
    ], { env: composeEnv, allowFailure: true })
    assert.notEqual(overwriteAttempt.code, 0)
    assert.match(overwriteAttempt.stderr, /Refusing to overwrite existing Docker volume/)

    await composeWithRestoredVolume(restoredVolume, 'config', '--quiet')
    await composeWithRestoredVolume(restoredVolume, 'up', '-d')
    containerId = (await composeWithRestoredVolume(restoredVolume, 'ps', '-q', 'chatbot')).stdout.trim()
    assert(containerId, 'Compose did not return the restored-volume container id')
    await waitForHealthy(containerId)

    const refreshAfterRestore = await request(port, '/api/auth/refresh', {
      auth: false,
      method: 'POST',
      headers: {
        Cookie: refreshCookie,
        Origin: `https://127.0.0.1:${port}`,
      },
    })
    assert.equal(refreshAfterRestore.status, 200)
    bearerToken = JSON.parse(refreshAfterRestore.text).accessToken
    refreshCookie = String(refreshAfterRestore.headers['set-cookie']).split(';')[0]

    const afterList = JSON.parse((await request(port, '/api/conversations')).text).conversations
    const afterDetails = Object.fromEntries(await Promise.all(afterList.map(async (conversation) => {
      const detail = await request(port, `/api/conversations/${conversation.id}`)
      assert.equal(detail.status, 200)
      return [conversation.id, JSON.parse(detail.text).conversation]
    })))
    assert.deepEqual(afterList, beforeList)
    assert.deepEqual(afterDetails, beforeDetails)

    const attachmentAfterRestore = await request(
      port,
      `/api/conversations/${visionConversationId}/attachments/${attachment.id}`,
    )
    assert.equal(attachmentAfterRestore.status, 200)
    assert.equal(attachmentAfterRestore.headers['content-type'], 'image/png')
    assert.equal(attachmentAfterRestore.buffer.length, PNG_1X1.length)
    assert.equal(createHash('sha256').update(attachmentAfterRestore.buffer).digest('hex'), imageSha256)

    const dockerUiDebugPort = await findAvailablePort()
    const dockerUi = await run('bun', ['tests/cdp/docker-ui.mjs'], {
      env: {
        ...process.env,
        APP_URL: `https://127.0.0.1:${port}/`,
        DEBUG_PORT: String(dockerUiDebugPort),
        CDP_SCREENSHOTS: '0',
        DOCKER_UI_USERNAME: authUsername,
        DOCKER_UI_PASSWORD: authPassword,
        DOCKER_UI_EXPECT_CONVERSATION_TITLE: visionDetailBeforeRestart.title,
        DOCKER_UI_EXPECT_ATTACHMENT_FILENAME: attachment.filename,
      },
      timeoutMs: TIMEOUT_MS,
    })
    assert.match(dockerUi.stdout, /"attachmentLoaded": true/)

    const providerCallsBeforeHistoricalContinuation = providerCallCount
    const historicalContinuation = await request(
      port,
      `/api/conversations/${visionConversationId}/ask`,
      {
        method: 'POST',
        body: {
          question: '继续根据历史图片回答',
          requestId: `request_docker_vision_history_${Date.now()}`,
          options: visionModelOptions,
        },
      },
    )
    assert.equal(historicalContinuation.status, 200, historicalContinuation.text)
    assert.match(historicalContinuation.text, /"type":"done"/)
    assert.equal(providerCallCount, providerCallsBeforeHistoricalContinuation + 1)
    assert.match(JSON.stringify(providerRequestBodies.at(-1)), /data:image\/png;base64,/)

    const sourceInspect = await run('docker', ['volume', 'inspect', sourceVolume], {
      env: composeEnv,
      allowFailure: true,
    })
    assert.equal(sourceInspect.code, 0)
    const sourceManifestAfterRestore = JSON.parse((await run('docker', [
      'run',
      '--rm',
      '--entrypoint',
      'bun',
      '--mount',
      `type=volume,source=${sourceVolume},target=/data,readonly`,
      'chatbot:local',
      '/app/docker/volume-manifest.mjs',
      '/data',
    ])).stdout)
    assert.equal(sourceManifestAfterRestore.treeSha256, manifest.data.treeSha256)

    const logout = await request(port, '/api/auth/logout', {
      auth: false,
      method: 'POST',
      headers: {
        Cookie: refreshCookie,
        Origin: `https://127.0.0.1:${port}`,
      },
    })
    assert.equal(logout.status, 204)
    const revokedAccess = await request(port, '/api/runtime-config')
    assert.equal(revokedAccess.status, 401)

    console.log(JSON.stringify({
      ok: true,
      project: PROJECT_NAME,
      image: 'chatbot:local',
      imageSizeBytes: runtimeImageSizeBytes,
      httpsPort: port,
      assertions: [
        'compose config valid',
        'default and overridden TLS source paths valid',
        'image built and container healthy',
        'runtime image stays below 300MB without build, pnpm, or Bun install caches',
        'application process runs with Bun 1.4.0 as the non-root bun user',
        'React build served over Bun HTTPS',
        'authentication fail-fast, login, secure refresh cookie, and API protection valid',
        'runtime config, compatibility health, liveness, readiness, and JSON 404 valid',
        'unwritable storage reports readiness 503 while liveness remains 200, then recovers',
        'SQLite conversation, model options, image attachment, and request records persist across restart',
        'completed requestId replay after restart does not call the Provider twice',
        'authentication session persists across restart and restored volume, then logout revokes access',
        'SIGTERM stopped Bun gracefully with exit code 0',
        'backup refuses a volume mounted by a running container',
        'stopped-volume backup includes checksums, SQLite data, and attachment data/sidecar files',
        'checksum mismatch and existing restore target fail safely',
        'new-volume restore preserves conversations, model options, R12 metadata, and attachment SHA-256 exactly',
        'restored protected thumbnail and full preview load in a real browser',
        'historical image continuation works from the restored volume',
        'source volume tree hash remains unchanged after restored-volume switch',
      ],
    }, null, 2))
  } finally {
    await run('docker', ['compose', '-p', PROJECT_NAME, 'down', '--remove-orphans'], {
      env: composeEnv,
      allowFailure: true,
      timeoutMs: CLEANUP_TIMEOUT_MS,
    }).catch(() => undefined)
    for (const volumeName of [restoredVolume, rejectedVolume, sourceVolume]) {
      if (!volumeName) continue
      await run('docker', ['volume', 'rm', volumeName], {
        env: composeEnv,
        allowFailure: true,
        timeoutMs: CLEANUP_TIMEOUT_MS,
      }).catch(() => undefined)
    }
    if (mockProvider) {
      await new Promise((resolve) => mockProvider.close(() => resolve()))
    }
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
