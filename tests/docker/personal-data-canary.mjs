import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashPassword } from '../../bun-server/security/password.ts'
import {
  assertImageName,
  assertVolumeExists,
  assertVolumeName,
  assertVolumeStopped,
  readVolumeManifest,
  runCommand,
} from '../../scripts/docker-volume-utils.mjs'

const REPO_ROOT = process.cwd()
const TIMEOUT_MS = 120_000
const COMMAND_TIMEOUT_MS = 180_000
const CONTEXT_WINDOW_TOKENS = 80_000
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZP4sAAAAASUVORK5CYII=',
  'base64',
)
let bearerToken = ''

function readArguments(argv) {
  const options = { image: 'chatbot:local' }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (![
      '--source-volume',
      '--validation-volume',
      '--expected-conversations',
      '--certificate',
      '--private-key',
      '--image',
    ].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
    options[argument.slice(2)] = value
    index += 1
  }
  for (const key of [
    'source-volume',
    'validation-volume',
    'expected-conversations',
    'certificate',
    'private-key',
  ]) {
    if (!options[key]) throw new Error(`--${key} is required`)
  }
  const expectedConversations = Number(options['expected-conversations'])
  if (!Number.isSafeInteger(expectedConversations) || expectedConversations < 1) {
    throw new Error('--expected-conversations must be a positive integer')
  }
  return {
    sourceVolume: options['source-volume'],
    validationVolume: options['validation-volume'],
    expectedConversations,
    certificate: path.resolve(options.certificate),
    privateKey: path.resolve(options['private-key']),
    image: options.image,
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs ?? COMMAND_TIMEOUT_MS)
    timeout.unref()
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }
      if (code === 0 || options.allowFailure) resolve(result)
      else reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${result.stdout}${result.stderr}`))
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
    const request = https.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: options.method ?? 'GET',
      rejectUnauthorized: false,
      headers: {
        Accept: 'application/json',
        ...(bearerToken && options.auth !== false && {
          Authorization: `Bearer ${bearerToken}`,
        }),
        ...(body !== undefined && {
          ...(jsonBody && { 'Content-Type': 'application/json' }),
          'Content-Length': body.byteLength,
        }),
        ...options.headers,
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
    request.once('error', reject)
    if (body !== undefined) request.write(body)
    request.end()
  })
}

function createMultipartImageBody(image) {
  const boundary = `----chatbot-personal-canary-${randomBytes(12).toString('hex')}`
  const body = Buffer.concat([
    Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="image"; filename="personal-canary.png"',
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
      throw new Error(`Canary container became ${status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Timed out waiting for personal-data canary container')
}

async function main() {
  const options = readArguments(process.argv.slice(2))
  assertVolumeName(options.sourceVolume, 'source volume')
  assertVolumeName(options.validationVolume, 'validation volume')
  assertImageName(options.image)
  assert.notEqual(options.sourceVolume, options.validationVolume)
  await Promise.all([
    assertVolumeExists(options.sourceVolume),
    assertVolumeExists(options.validationVolume),
    assertVolumeStopped(options.sourceVolume),
    assertVolumeStopped(options.validationVolume),
  ])
  const restoreLabel = (await runCommand('docker', [
    'volume',
    'inspect',
    '--format',
    '{{index .Labels "com.chatbot.restore"}}',
    options.validationVolume,
  ])).stdout
  assert.equal(restoreLabel, 'true', 'validation volume was not created by the restore workflow')
  const [sourceBefore, validationBefore] = await Promise.all([
    readVolumeManifest(options.image, options.sourceVolume),
    readVolumeManifest(options.image, options.validationVolume),
  ])
  assert.equal(validationBefore.treeSha256, sourceBefore.treeSha256)

  const tempDir = await mkdtemp(path.join(tmpdir(), 'chatbot-personal-canary-'))
  const envFile = path.join(tempDir, 'canary.env')
  const dockerConfigDir = path.join(tempDir, 'docker-config')
  const port = await findAvailablePort()
  let debugPort = await findAvailablePort()
  while (debugPort === port) debugPort = await findAvailablePort()
  let providerPort = await findAvailablePort()
  while (providerPort === port || providerPort === debugPort) {
    providerPort = await findAvailablePort()
  }
  const projectName = `chatbot-personal-canary-${process.pid}`
  const username = 'personal-canary-user'
  const password = `personal-canary-password-${randomBytes(8).toString('hex')}`
  const passwordHash = await hashPassword(password)
  const imageSha256 = createHash('sha256').update(PNG_1X1).digest('hex')
  let containerId = ''
  let testConversationId = ''
  let refreshCookie = ''
  let totalMessages = 0
  let contextPreviewVerified = false
  let browserVerified = false
  let mockProviderCalls = 0
  const mockProviderRequestBodies = []
  const mockProvider = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        mockProviderCalls += 1
        mockProviderRequestBodies.push(body)
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end([
          'data: {"choices":[{"delta":{"content":"Personal canary attachment answer"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ].join(''))
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          error: { message: error instanceof Error ? error.message : 'bad request' },
        }))
      }
    })
  })

  await new Promise((resolve, reject) => {
    mockProvider.once('error', reject)
    mockProvider.listen(providerPort, '0.0.0.0', resolve)
  })

  await mkdir(dockerConfigDir)
  await writeFile(path.join(dockerConfigDir, 'config.json'), JSON.stringify({
    auths: {},
    cliPluginsExtraDirs: ['/Applications/Docker.app/Contents/Resources/cli-plugins'],
  }))
  await writeFile(envFile, [
    'LLM_PROVIDER=deepseek',
    `DEEPSEEK_ENDPOINT=http://host.docker.internal:${providerPort}/chat/completions`,
    'DEEPSEEK_MODEL=deepseek-v4-flash',
    'DEEPSEEK_API_KEY=personal-canary-no-provider-call',
    `DEEPSEEK_CONTEXT_WINDOW_TOKENS=${CONTEXT_WINDOW_TOKENS}`,
    'CONVERSATION_STORE=sqlite',
    'AUTH_ENABLED=true',
    `AUTH_USERNAME=${username}`,
    `AUTH_PASSWORD_HASH='${passwordHash}'`,
    `AUTH_ACCESS_TOKEN_SECRET=${randomBytes(32).toString('base64url')}`,
    `AUTH_REFRESH_TOKEN_SECRET=${randomBytes(32).toString('base64url')}`,
    `AUTH_ALLOWED_ORIGINS=https://127.0.0.1:${port}`,
    '',
  ].join('\n'), { mode: 0o600 })
  const composeEnv = {
    ...process.env,
    CHATBOT_ENV_FILE: envFile,
    CHATBOT_HTTPS_PORT: String(port),
    CHATBOT_TLS_CERT_SOURCE: await realpath(options.certificate),
    CHATBOT_TLS_KEY_SOURCE: await realpath(options.privateKey),
    CHATBOT_DATA_VOLUME: options.validationVolume,
    DOCKER_CONFIG: dockerConfigDir,
  }
  const compose = (...args) => run('docker', [
    'compose',
    '-p',
    projectName,
    '-f',
    'compose.yaml',
    '-f',
    'compose.data-volume.yaml',
    ...args,
  ], { env: composeEnv })

  try {
    await compose('config', '--quiet')
    await compose('up', '-d')
    containerId = (await compose('ps', '-q', 'chatbot')).stdout.trim()
    assert(containerId)
    await waitForHealthy(containerId)
    const mounts = JSON.parse((await run('docker', [
      'inspect', '--format', '{{json .Mounts}}', containerId,
    ])).stdout)
    assert.equal(
      mounts.find((mount) => mount.Destination === '/app/data')?.Name,
      options.validationVolume,
    )
    const processes = (await run('docker', ['top', containerId, '-eo', 'pid,user,args'])).stdout
    assert.match(processes, /^\s*\d+\s+(?:1000|bun)\s+bun bun-server\/bin\/www\.ts$/m)

    const liveness = await request(port, '/api/health/live', { auth: false })
    const readiness = await request(port, '/api/health/ready', { auth: false })
    assert.equal(liveness.status, 200)
    assert.equal(readiness.status, 200)
    assert.deepEqual(JSON.parse(readiness.text), {
      status: 'ok',
      checks: { configuration: 'ok', storage: 'ok' },
    })
    const login = await request(port, '/api/auth/login', {
      auth: false,
      method: 'POST',
      headers: { Origin: `https://127.0.0.1:${port}` },
      body: { username, password },
    })
    assert.equal(login.status, 200, login.text)
    bearerToken = JSON.parse(login.text).accessToken
    refreshCookie = String(login.headers['set-cookie']).split(';')[0]
    assert(bearerToken)
    assert.match(refreshCookie, /^chatbot_refresh=/)

    const conversationsResponse = await request(port, '/api/conversations')
    assert.equal(conversationsResponse.status, 200)
    const conversations = JSON.parse(conversationsResponse.text).conversations
    assert.equal(conversations.length, options.expectedConversations)
    const details = []
    for (const conversation of conversations) {
      const detailResponse = await request(port, `/api/conversations/${conversation.id}`)
      assert.equal(detailResponse.status, 200)
      details.push(JSON.parse(detailResponse.text).conversation)
    }
    totalMessages = details.reduce((total, conversation) => total + conversation.messages.length, 0)
    const contextCandidate = details.find((conversation) => conversation.messages.length > 0)
    assert(contextCandidate, 'personal data has no conversation with messages to preview')
    const contextResponse = await request(
      port,
      `/api/conversations/${contextCandidate.id}/context-preview`,
      {
        method: 'POST',
        body: {
          question: 'personal canary context preview',
          options: {
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            reasoningEnabled: false,
            reasoningEffort: 'max',
            maxTokens: 2048,
          },
        },
      },
    )
    assert.equal(contextResponse.status, 200, contextResponse.text)
    const context = JSON.parse(contextResponse.text).context
    assert.equal(context.stats.totalHistoryMessages, contextCandidate.messages.length)
    assert.equal(context.stats.contextWindowTokens, CONTEXT_WINDOW_TOKENS)
    assert.equal(context.model.contextWindowTokens, CONTEXT_WINDOW_TOKENS)
    assert(context.stats.estimatedTotalTokens <= CONTEXT_WINDOW_TOKENS)
    contextPreviewVerified = true

    const created = await request(port, '/api/conversations', {
      method: 'POST',
      body: { title: 'Personal canary attachment fixture' },
    })
    assert.equal(created.status, 201)
    testConversationId = JSON.parse(created.text).conversation.id
    const multipart = createMultipartImageBody(PNG_1X1)
    const uploaded = await request(port, `/api/conversations/${testConversationId}/attachments`, {
      method: 'POST',
      rawBody: multipart.body,
      headers: { 'Content-Type': multipart.contentType },
    })
    assert.equal(uploaded.status, 201, uploaded.text)
    const attachment = JSON.parse(uploaded.text).attachment
    const attachmentRead = await request(
      port,
      `/api/conversations/${testConversationId}/attachments/${attachment.id}`,
    )
    assert.equal(attachmentRead.status, 200)
    assert.equal(createHash('sha256').update(attachmentRead.buffer).digest('hex'), imageSha256)

    const ask = await request(port, `/api/conversations/${testConversationId}/ask`, {
      method: 'POST',
      body: {
        question: 'persist the canary attachment with the local mock provider',
        requestId: `request_personal_canary_${randomBytes(8).toString('hex')}`,
        attachmentIds: [attachment.id],
        options: {
          provider: 'deepseek',
          model: 'deepseek-v4-flash-vision-exp',
          reasoningEnabled: false,
          reasoningEffort: 'max',
          maxTokens: 2048,
        },
      },
    })
    assert.equal(ask.status, 200, ask.text)
    assert.match(ask.text, /"type":"done"/)
    assert.equal(mockProviderCalls, 1)
    assert.match(JSON.stringify(mockProviderRequestBodies[0]), /data:image\/png;base64,/)

    const browser = await run('bun', ['tests/cdp/docker-ui.mjs'], {
      env: {
        ...process.env,
        APP_URL: `https://127.0.0.1:${port}/`,
        DEBUG_PORT: String(debugPort),
        CDP_SCREENSHOTS: '0',
        DOCKER_UI_USERNAME: username,
        DOCKER_UI_PASSWORD: password,
        DOCKER_UI_EXPECT_CONVERSATION_TITLE: 'Personal canary attachment fixture',
        DOCKER_UI_EXPECT_ATTACHMENT_FILENAME: attachment.filename,
        DOCKER_UI_EXPECT_MIN_CONVERSATIONS: String(options.expectedConversations + 1),
      },
      timeoutMs: TIMEOUT_MS,
    })
    assert.match(browser.stdout, /"attachmentLoaded": true/)
    assert.match(browser.stdout, new RegExp(`"conversationCount": ${options.expectedConversations + 1}`))
    browserVerified = true

    const deleted = await request(port, `/api/conversations/${testConversationId}`, { method: 'DELETE' })
    assert.equal(deleted.status, 204)
    testConversationId = ''
    const afterCleanup = JSON.parse((await request(port, '/api/conversations')).text).conversations
    assert.equal(afterCleanup.length, options.expectedConversations)
    const logout = await request(port, '/api/auth/logout', {
      auth: false,
      method: 'POST',
      headers: {
        Cookie: refreshCookie,
        Origin: `https://127.0.0.1:${port}`,
      },
    })
    assert.equal(logout.status, 204)
  } finally {
    if (testConversationId && containerId) {
      await request(port, `/api/conversations/${testConversationId}`, { method: 'DELETE' })
        .catch(() => undefined)
    }
    await compose('down', '--remove-orphans').catch(() => undefined)
    await new Promise((resolve) => mockProvider.close(() => resolve()))
    await rm(tempDir, { recursive: true, force: true })
  }

  await assertVolumeStopped(options.sourceVolume)
  const sourceAfter = await readVolumeManifest(options.image, options.sourceVolume)
  assert.equal(sourceAfter.treeSha256, sourceBefore.treeSha256)
  console.log(JSON.stringify({
    ok: true,
    sourceVolume: options.sourceVolume,
    validationVolume: options.validationVolume,
    conversationCount: options.expectedConversations,
    totalMessages,
    assertions: {
      restoredTreeMatchesSource: validationBefore.treeSha256 === sourceBefore.treeSha256,
      BunProcess: true,
      liveness: true,
      readiness: true,
      login: true,
      allConversationDetailsReadable: true,
      contextPreview: contextPreviewVerified,
      attachmentFixture: true,
      browser: browserVerified,
      sourceVolumeUnchanged: sourceAfter.treeSha256 === sourceBefore.treeSha256,
      mockProviderCalls,
      realProviderCalls: 0,
      screenshots: 0,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
