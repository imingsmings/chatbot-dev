import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import https from 'node:https'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashPassword } from '../../server/security/password.ts'

const REPO_ROOT = process.cwd()
const PROJECT_NAME = `chatbot-docker-test-${process.pid}`
const TIMEOUT_MS = 120_000
const COMMAND_TIMEOUT_MS = 300_000
const CLEANUP_TIMEOUT_MS = 30_000
const MAX_RUNTIME_IMAGE_SIZE_BYTES = 300_000_000
let bearerToken = ''

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
        ...(bearerToken && options.auth !== false
          ? { Authorization: `Bearer ${bearerToken}` }
          : {}),
        ...(body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            }
          : {}),
        ...(options.headers ?? {}),
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
  const restoredVolume = `${PROJECT_NAME}-restored`
  const rejectedVolume = `${PROJECT_NAME}-rejected`
  const authUsername = 'docker-smoke-user'
  const authPassword = `docker-smoke-password-${process.pid}`
  const authPasswordHash = await hashPassword(authPassword)
  let refreshCookie = ''

  await writeFile(envFile, [
    'LLM_PROVIDER=deepseek',
    'DEEPSEEK_ENDPOINT=https://mock.invalid/chat/completions',
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
    await run('docker', [
      'exec',
      '--user',
      'root',
      containerId,
      'sh',
      '-lc',
      'test ! -e /root/.cache/pnpm && test ! -e /root/.cache/node/corepack/v1/pnpm',
    ])
    const processList = (await run('docker', [
      'top',
      containerId,
      '-eo',
      'pid,user,args',
    ])).stdout.trim()
    assert.match(processList, /^\s*\d+\s+(?:1000|node)\s+node server\/bin\/www\.ts$/m)

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
    assert.equal(health.status, 200)
    assert.deepEqual(JSON.parse(health.text), {
      status: 'ok',
      checks: { configuration: 'ok', storage: 'ok' },
    })

    await run('docker', ['exec', '--user', 'root', containerId, 'chmod', '0555', '/app/data/sqlite'])
    await run('docker', [
      'exec', '--user', 'root', containerId,
      'chmod', '0444', '/app/data/sqlite/conversations.sqlite3',
    ])
    const unwritableHealth = await request(port, '/api/health')
    assert.equal(unwritableHealth.status, 503)
    assert.deepEqual(JSON.parse(unwritableHealth.text), {
      status: 'unhealthy',
      checks: { configuration: 'ok', storage: 'error' },
    })
    await run('docker', [
      'exec', '--user', 'root', containerId,
      'chmod', '0644', '/app/data/sqlite/conversations.sqlite3',
    ])
    await run('docker', ['exec', '--user', 'root', containerId, 'chmod', '0755', '/app/data/sqlite'])
    const recoveredHealth = await request(port, '/api/health')
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

    const runningBackupAttempt = await run('node', [
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

    await run('node', [
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

    const rejectedManifestPath = path.join(backupDir, 'rejected.manifest.json')
    await writeFile(rejectedManifestPath, JSON.stringify({
      ...manifest,
      archive: { ...manifest.archive, sha256: '0'.repeat(64) },
    }))
    const rejectedRestore = await run('node', [
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

    await run('node', [
      'scripts/docker-volume-restore.mjs',
      '--manifest',
      manifestPath,
      '--volume',
      restoredVolume,
    ], { env: composeEnv })
    const overwriteAttempt = await run('node', [
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

    const sourceInspect = await run('docker', ['volume', 'inspect', sourceVolume], {
      env: composeEnv,
      allowFailure: true,
    })
    assert.equal(sourceInspect.code, 0)

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
        'runtime image stays below 300MB without pnpm/Corepack caches',
        'application process runs as non-root node user',
        'React build served over HTTPS',
        'authentication fail-fast, login, secure refresh cookie, and API protection valid',
        'runtime config, storage-aware health, and JSON 404 valid',
        'unwritable storage reports 503 and recovers',
        'SQLite conversation and model options persisted across restart',
        'authentication session persists across restart and restored volume, then logout revokes access',
        'SIGTERM shutdown exited with code 0',
        'backup refuses a volume mounted by a running container',
        'stopped-volume backup includes checksums and SQLite data directory',
        'checksum mismatch and existing restore target fail safely',
        'new-volume restore preserves conversations, model options, and R12 message metadata exactly',
        'source volume remains intact after restored-volume switch',
      ],
    }, null, 2))
  } finally {
    await run('docker', ['compose', '-p', PROJECT_NAME, 'down', '-v', '--remove-orphans'], {
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
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
