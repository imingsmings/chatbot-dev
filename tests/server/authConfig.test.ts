import assert from 'node:assert/strict'
import test from 'node:test'
import { getAuthConfig } from '../../server/config/authConfig.ts'

function phcBase64(byte: number, length: number): string {
  return Buffer.alloc(length, byte).toString('base64').replace(/=+$/, '')
}

const validPasswordHash = [
  '$argon2id$v=19$m=19456,p=1,t=2',
  phcBase64(1, 16),
  phcBase64(2, 32),
].join('$')

const baseEnvironment: NodeJS.ProcessEnv = {
  AUTH_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
  AUTH_COOKIE_SECURE: 'true',
  AUTH_ENABLED: 'true',
  AUTH_PASSWORD_HASH: validPasswordHash,
  AUTH_REFRESH_TOKEN_SECRET: 'b'.repeat(32),
  AUTH_USERNAME: 'local-user',
  NODE_ENV: 'production',
}

test('production authentication is enabled by default and requires HTTPS', () => {
  const environment = { ...baseEnvironment }
  delete environment.AUTH_ENABLED

  assert.throws(
    () => getAuthConfig(environment, { httpsEnabled: false }),
    /必须同时启用 HTTPS/,
  )
  assert.equal(getAuthConfig(environment, { httpsEnabled: true }).enabled, true)
})

test('authentication configuration rejects weak, reused, and malformed secrets', () => {
  assert.throws(
    () => getAuthConfig({ ...baseEnvironment, AUTH_ACCESS_TOKEN_SECRET: 'short' }),
    /至少包含 32 字节/,
  )
  assert.throws(
    () => getAuthConfig({
      ...baseEnvironment,
      AUTH_REFRESH_TOKEN_SECRET: baseEnvironment.AUTH_ACCESS_TOKEN_SECRET,
    }),
    /必须使用不同 secret/,
  )
  assert.throws(
    () => getAuthConfig({ ...baseEnvironment, AUTH_PASSWORD_HASH: 'plain-text' }),
    /必须是有效的 Argon2id v19 哈希/,
  )
  assert.throws(
    () => getAuthConfig({ ...baseEnvironment, AUTH_PASSWORD_HASH: '$argon2id$malformed' }),
    /必须是有效的 Argon2id v19 哈希/,
  )
  assert.throws(
    () => getAuthConfig({
      ...baseEnvironment,
      AUTH_PASSWORD_HASH: '$argon2id$v=19$m=4096,p=1,t=1$placeholder$sufficient',
    }),
    /参数不得低于/,
  )
  assert.throws(
    () => getAuthConfig({
      ...baseEnvironment,
      AUTH_PASSWORD_HASH: [
        '$argon2id$v=19$m=19456,p=1,t=2',
        phcBase64(1, 8),
        phcBase64(2, 32),
      ].join('$'),
    }),
    /salt 不得少于 16 字节/,
  )
  assert.throws(
    () => getAuthConfig({
      ...baseEnvironment,
      AUTH_PASSWORD_HASH: [
        '$argon2id$v=19$m=19456,p=1,t=2',
        phcBase64(1, 16),
        phcBase64(2, 16),
      ].join('$'),
    }),
    /摘要不得少于 32 字节/,
  )
})

test('development can explicitly disable authentication without credentials', () => {
  const config = getAuthConfig({
    AUTH_ENABLED: 'false',
    NODE_ENV: 'development',
  })
  assert.equal(config.enabled, false)
  assert.equal(config.accessSecret, '')
})
