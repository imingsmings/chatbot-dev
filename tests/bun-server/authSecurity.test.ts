import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, test } from 'bun:test'
import type { AuthConfig } from '../../bun-server/config/authConfig.ts'
import { AuthError } from '../../bun-server/security/authErrors.ts'
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../bun-server/security/jwt.ts'
import { hashPassword, verifyPassword } from '../../bun-server/security/password.ts'
import { createLoginSession, refreshLoginSession } from '../../bun-server/services/authService.ts'
import {
  closeAuthSessionStores,
  createAuthSession,
  isAuthSessionActive,
  revokeAllAuthSessions,
  rotateRefreshToken,
} from '../../bun-server/utils/authSessionStore.ts'

const tempRoot = await mkdtemp(path.join(tmpdir(), 'chatbot-auth-security-'))
const config: AuthConfig = {
  accessSecret: 'access-secret-value-01234567890123456789',
  accessTtlSeconds: 900,
  allowedOrigins: new Set(),
  audience: 'chatbot-api-test',
  cookieName: 'chatbot_refresh',
  cookieSecure: false,
  databasePath: path.join(tempRoot, 'auth.sqlite3'),
  enabled: true,
  issuer: 'chatbot-test',
  loginRateLimitMax: 5,
  loginRateLimitWindowMs: 60_000,
  passwordHash: '',
  refreshRateLimitMax: 60,
  refreshRateLimitWindowMs: 60_000,
  refreshSecret: 'refresh-secret-value-012345678901234567',
  refreshTtlSeconds: 604_800,
  username: 'tester',
}

afterAll(async () => {
  closeAuthSessionStores()
  await rm(tempRoot, { recursive: true, force: true })
})

test('Argon2id hashes and verifies without accepting a wrong password', async () => {
  const hash = await hashPassword('correct horse battery staple')
  assert.match(hash, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/)
  assert.equal(await verifyPassword(hash, 'correct horse battery staple'), true)
  assert.equal(await verifyPassword(hash, 'wrong'), false)
  await assert.rejects(
    () => createLoginSession('tester', 'password', {
      ...config,
      passwordHash: '$argon2id$malformed',
    }),
    (error) => error instanceof AuthError && error.code === 'auth_unavailable' && error.status === 503,
  )
})

test('JWT verification fixes algorithm, issuer, audience, type, and secret', async () => {
  const access = await signAccessToken('tester', 'sid-access', config, 2_000_000_000)
  const refresh = await signRefreshToken(
    'tester',
    'sid-access',
    'family-access',
    2_000_100_000,
    config,
    2_000_000_000,
  )
  assert.equal((await verifyAccessToken(access.token, config)).sid, 'sid-access')
  assert.equal((await verifyRefreshToken(refresh.token, config)).family_id, 'family-access')

  await assert.rejects(() => verifyAccessToken(refresh.token, config), AuthError)
  await assert.rejects(
    () => verifyAccessToken(access.token, { ...config, audience: 'wrong-audience' }),
    AuthError,
  )
  await assert.rejects(
    () => verifyAccessToken(access.token, { ...config, accessSecret: 'x'.repeat(40) }),
    AuthError,
  )
  await assert.rejects(
    () => verifyAccessToken(access.token, { ...config, issuer: 'wrong-issuer' }),
    AuthError,
  )

  const expired = await signAccessToken(
    'tester',
    'sid-expired',
    config,
    Math.floor(Date.now() / 1000) - config.accessTtlSeconds - 1,
  )
  await assert.rejects(() => verifyAccessToken(expired.token, config), (error) => (
    error instanceof AuthError && error.code === 'token_expired'
  ))

  const tokenParts = access.token.split('.')
  tokenParts[1] = Buffer.from(JSON.stringify({ token_use: 'access' })).toString('base64url')
  await assert.rejects(() => verifyAccessToken(tokenParts.join('.'), config), AuthError)

  const [header, payload] = access.token.split('.')
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  await assert.rejects(() => verifyAccessToken(`${noneHeader}.${payload}.`, config), AuthError)
  assert(header)
})

test('concurrent refresh reuse revokes the token family after one rotation', async () => {
  const now = Math.floor(Date.now() / 1000)
  const sid = 'sid-concurrent'
  const familyId = 'family-concurrent'
  const original = await signRefreshToken(
    'tester',
    sid,
    familyId,
    now + 600,
    config,
    now,
  )
  createAuthSession(config, {
    expiresAt: now + 600,
    familyId,
    issuedAt: now,
    jti: original.claims.jti,
    sid,
    subject: 'tester',
  })

  const results = await Promise.allSettled([
    refreshLoginSession(original.token, config, now + 1),
    refreshLoginSession(original.token, config, now + 1),
  ])

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.equal(isAuthSessionActive(config, sid, 'tester', now + 1), false)
})

test('refresh rotation is atomic and replay revokes the whole session', () => {
  const now = Math.floor(Date.now() / 1000)
  createAuthSession(config, {
    expiresAt: now + 600,
    familyId: 'family-rotation',
    issuedAt: now,
    jti: 'refresh-old',
    sid: 'sid-rotation',
    subject: 'tester',
  })

  assert.deepEqual(rotateRefreshToken(config, {
    currentJti: 'refresh-old',
    familyId: 'family-rotation',
    issuedAt: now + 1,
    newJti: 'refresh-new',
    sid: 'sid-rotation',
  }), { status: 'rotated', sessionExpiresAt: now + 600 })
  assert.equal(isAuthSessionActive(config, 'sid-rotation', 'tester', now + 1), true)

  assert.deepEqual(rotateRefreshToken(config, {
    currentJti: 'refresh-old',
    familyId: 'family-rotation',
    issuedAt: now + 2,
    newJti: 'refresh-attacker',
    sid: 'sid-rotation',
  }), { status: 'replayed' })
  assert.equal(isAuthSessionActive(config, 'sid-rotation', 'tester', now + 2), false)
})

test('revoke all sessions invalidates every active access session', () => {
  const now = Math.floor(Date.now() / 1000)
  for (const suffix of ['one', 'two']) {
    createAuthSession(config, {
      expiresAt: now + 600,
      familyId: `family-${suffix}`,
      issuedAt: now,
      jti: `jti-${suffix}`,
      sid: `sid-${suffix}`,
      subject: 'tester',
    })
  }
  assert.equal(revokeAllAuthSessions(config, 'test', now + 1) >= 2, true)
  assert.equal(isAuthSessionActive(config, 'sid-one', 'tester', now + 1), false)
  assert.equal(isAuthSessionActive(config, 'sid-two', 'tester', now + 1), false)
})
