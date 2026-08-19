import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { hashPassword } from '../../server/security/password.ts'

const tempRoot = await mkdtemp(path.join(tmpdir(), 'chatbot-auth-api-'))
const password = 'auth-api-test-password'
const passwordHash = await hashPassword(password)

Object.assign(process.env, {
  AUTH_ACCESS_TOKEN_SECRET: 'a'.repeat(40),
  AUTH_COOKIE_SECURE: 'false',
  AUTH_ENABLED: 'true',
  AUTH_LOGIN_RATE_LIMIT_MAX: '3',
  AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: '60000',
  AUTH_PASSWORD_HASH: passwordHash,
  AUTH_REFRESH_TOKEN_SECRET: 'b'.repeat(40),
  AUTH_SESSION_DB_PATH: path.join(tempRoot, 'auth.sqlite3'),
  AUTH_USERNAME: 'tester',
  CONVERSATION_DATA_DIR: path.join(tempRoot, 'conversations'),
  CONVERSATION_STORE: 'file',
  DEEPSEEK_API_KEY: 'test-key',
  LLM_ENDPOINT: 'https://provider.invalid/v1',
  LLM_PROVIDER: 'deepseek',
  NODE_ENV: 'test',
})

const { createApp } = await import('../../server/app.ts')
const { closeAuthSessionStores } = await import('../../server/utils/authSessionStore.ts')

let origin = ''
let closeServer: (() => Promise<void>) | null = null

before(async () => {
  const server = http.createServer(createApp({
    validateRuntime: false,
    clientHosting: { enabled: false, distDir: '' },
  }))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  origin = `http://127.0.0.1:${address.port}`
  closeServer = () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
})

after(async () => {
  await closeServer?.()
  closeAuthSessionStores()
  await rm(tempRoot, { recursive: true, force: true })
})

function cookieFrom(response: Response): string {
  return response.headers.get('set-cookie')?.split(';')[0] ?? ''
}

async function login(username = 'tester', suppliedPassword = password) {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ username, password: suppliedPassword }),
  })
  const body = await response.json().catch(() => null) as {
    accessToken?: string
    code?: string
    expiresAt?: number
  } | null
  return { body, cookie: cookieFrom(response), response }
}

test('status and health stay public while API and legacy roots require a bearer token', async () => {
  const status = await fetch(`${origin}/api/auth/status`)
  assert.equal(status.status, 200)
  assert.deepEqual(await status.json(), { enabled: true })

  const health = await fetch(`${origin}/api/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), {
    status: 'ok',
    checks: { configuration: 'ok', storage: 'ok' },
  })

  for (const pathname of ['/api/runtime-config', '/runtime-config', '/api/not-a-route']) {
    const response = await fetch(`${origin}${pathname}`)
    assert.equal(response.status, 401)
    assert.equal((await response.json()).code, 'auth_required')
  }
})

test('login is origin-checked, generic on failure, and returns secure cookie attributes', async () => {
  const missingOrigin = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password }),
  })
  assert.equal(missingOrigin.status, 403)

  const crossOrigin = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' },
    body: JSON.stringify({ username: 'tester', password }),
  })
  assert.equal(crossOrigin.status, 403)

  const failed = await login('tester', 'wrong-password')
  assert.equal(failed.response.status, 401)
  assert.equal(failed.body?.code, 'invalid_credentials')

  const authenticated = await login()
  assert.equal(authenticated.response.status, 200)
  assert(authenticated.body?.accessToken)
  assert.equal(typeof authenticated.body?.expiresAt, 'number')
  const setCookie = authenticated.response.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /chatbot_refresh=/)
  assert.match(setCookie, /HttpOnly/i)
  assert.match(setCookie, /SameSite=Strict/i)
  assert.match(setCookie, /Path=\/api\/auth/i)

  const runtime = await fetch(`${origin}/api/runtime-config`, {
    headers: { Authorization: `Bearer ${authenticated.body.accessToken}` },
  })
  assert.equal(runtime.status, 200)
})

test('refresh rotates once, replay revokes the family, and logout is idempotent', async () => {
  const authenticated = await login()
  assert.equal(authenticated.response.status, 200)
  const originalCookie = authenticated.cookie

  const refreshed = await fetch(`${origin}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: originalCookie, Origin: origin },
  })
  assert.equal(refreshed.status, 200)
  const refreshedBody = await refreshed.json() as { accessToken: string }
  const rotatedCookie = cookieFrom(refreshed)
  assert(rotatedCookie)
  assert.notEqual(rotatedCookie, originalCookie)

  const replay = await fetch(`${origin}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: originalCookie, Origin: origin },
  })
  assert.equal(replay.status, 401)
  assert.equal((await replay.json()).code, 'refresh_replayed')

  const revokedAccess = await fetch(`${origin}/api/runtime-config`, {
    headers: { Authorization: `Bearer ${refreshedBody.accessToken}` },
  })
  assert.equal(revokedAccess.status, 401)
  assert.equal((await revokedAccess.json()).code, 'session_revoked')

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const logout = await fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: rotatedCookie, Origin: origin },
    })
    assert.equal(logout.status, 204)
  }
})

test('login failures reach a stable rate limit with Retry-After', async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await login('rate-limit-subject', 'wrong-password')
    assert.equal(response.response.status, 401)
  }
  const limited = await login('rate-limit-subject', 'wrong-password')
  assert.equal(limited.response.status, 429)
  assert.equal(limited.body?.code, 'rate_limited')
  assert(Number(limited.response.headers.get('Retry-After')) > 0)

  const isolatedSubject = await login()
  assert.equal(isolatedSubject.response.status, 200)
})
