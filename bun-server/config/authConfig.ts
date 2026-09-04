import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBoolean } from './deploymentConfig.ts'

const serverDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60
const DEFAULT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60
const DEFAULT_ISSUER = 'chatbot-local'
const DEFAULT_AUDIENCE = 'chatbot-api'
const REFRESH_COOKIE_NAME = 'chatbot_refresh'
const ARGON2_MIN_MEMORY_COST = 19_456
const ARGON2_MIN_TIME_COST = 2
const ARGON2_MIN_PARALLELISM = 1
const ARGON2_MIN_SALT_BYTES = 16
const ARGON2_MIN_HASH_BYTES = 32

type AuthConfig = {
  accessSecret: string
  accessTtlSeconds: number
  allowedOrigins: Set<string>
  audience: string
  cookieName: string
  cookieSecure: boolean
  databasePath: string
  enabled: boolean
  issuer: string
  loginRateLimitMax: number
  loginRateLimitWindowMs: number
  passwordHash: string
  refreshRateLimitMax: number
  refreshRateLimitWindowMs: number
  refreshSecret: string
  refreshTtlSeconds: number
  username: string
}

type AuthConfigOptions = {
  httpsEnabled?: boolean
}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`)
  }
  return value
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? ''
  if (!value || value.startsWith('replace_with_')) {
    throw new Error(`${name} 未配置或仍是示例占位值`)
  }
  return value
}

function validateSecret(name: string, value: string): void {
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error(`${name} 必须至少包含 32 字节随机数据`)
  }
}

function decodePhcBase64(value: string): Buffer | null {
  if (value.length % 4 === 1) return null
  const decoded = Buffer.from(value.padEnd(Math.ceil(value.length / 4) * 4, '='), 'base64')
  const canonical = decoded.toString('base64').replace(/=+$/, '')
  return canonical === value ? decoded : null
}

function validatePasswordHash(value: string): void {
  const match = value.match(/^\$argon2id\$v=(\d+)\$([^$]+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/)
  if (!match || Number(match[1]) !== 19) {
    throw new Error('AUTH_PASSWORD_HASH 必须是有效的 Argon2id v19 哈希')
  }

  const parameterEntries = match[2].split(',')
  const parameterNames = parameterEntries.map((entry) => entry.split('=', 1)[0])
  if (
    parameterEntries.length !== 3 ||
    parameterEntries.some((entry) => !/^(?:m|t|p)=\d+$/.test(entry)) ||
    new Set(parameterNames).size !== 3
  ) {
    throw new Error('AUTH_PASSWORD_HASH 必须是有效的 Argon2id v19 哈希')
  }

  const parameters = Object.fromEntries(parameterEntries.map((entry) => {
    const [name, rawValue] = entry.split('=', 2)
    return [name, Number(rawValue)]
  }))
  if (
    !Number.isInteger(parameters.m) || parameters.m < ARGON2_MIN_MEMORY_COST ||
    !Number.isInteger(parameters.t) || parameters.t < ARGON2_MIN_TIME_COST ||
    !Number.isInteger(parameters.p) || parameters.p < ARGON2_MIN_PARALLELISM
  ) {
    throw new Error(
      `AUTH_PASSWORD_HASH 参数不得低于 m=${ARGON2_MIN_MEMORY_COST}, t=${ARGON2_MIN_TIME_COST}, p=${ARGON2_MIN_PARALLELISM}`
    )
  }

  const salt = decodePhcBase64(match[3])
  const digest = decodePhcBase64(match[4])
  if (
    !salt || salt.byteLength < ARGON2_MIN_SALT_BYTES ||
    !digest || digest.byteLength < ARGON2_MIN_HASH_BYTES
  ) {
    throw new Error(
      `AUTH_PASSWORD_HASH salt 不得少于 ${ARGON2_MIN_SALT_BYTES} 字节，摘要不得少于 ${ARGON2_MIN_HASH_BYTES} 字节`
    )
  }
}

function getAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: AuthConfigOptions = {}
): AuthConfig {
  const production = env.NODE_ENV === 'production'
  const enabled = readBoolean(env.AUTH_ENABLED, 'AUTH_ENABLED', production)
  const cookieSecure = readBoolean(
    env.AUTH_COOKIE_SECURE,
    'AUTH_COOKIE_SECURE',
    production
  )
  const dataRoot = env.CONVERSATION_DATA_DIR?.trim() || path.join(serverDirectory, 'data')
  const databasePath = path.resolve(
    env.AUTH_SESSION_DB_PATH?.trim() || path.join(dataRoot, 'auth-sessions.sqlite3')
  )
  const accessTtlSeconds = readPositiveInteger(
    env,
    'AUTH_ACCESS_TTL_SECONDS',
    DEFAULT_ACCESS_TTL_SECONDS,
    60,
    3600
  )
  const refreshTtlSeconds = readPositiveInteger(
    env,
    'AUTH_REFRESH_TTL_SECONDS',
    DEFAULT_REFRESH_TTL_SECONDS,
    3600,
    31_536_000
  )
  const loginRateLimitMax = readPositiveInteger(
    env,
    'AUTH_LOGIN_RATE_LIMIT_MAX',
    5,
    1,
    100
  )
  const loginRateLimitWindowMs = readPositiveInteger(
    env,
    'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS',
    15 * 60 * 1000,
    1000,
    24 * 60 * 60 * 1000
  )
  const refreshRateLimitMax = readPositiveInteger(
    env,
    'AUTH_REFRESH_RATE_LIMIT_MAX',
    60,
    1,
    1000
  )
  const refreshRateLimitWindowMs = readPositiveInteger(
    env,
    'AUTH_REFRESH_RATE_LIMIT_WINDOW_MS',
    60 * 1000,
    1000,
    24 * 60 * 60 * 1000
  )
  const allowedOrigins = new Set(
    (env.AUTH_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => new URL(value).origin)
  )

  if (!enabled) {
    return {
      accessSecret: '',
      accessTtlSeconds,
      allowedOrigins,
      audience: env.AUTH_JWT_AUDIENCE?.trim() || DEFAULT_AUDIENCE,
      cookieName: REFRESH_COOKIE_NAME,
      cookieSecure,
      databasePath,
      enabled,
      issuer: env.AUTH_JWT_ISSUER?.trim() || DEFAULT_ISSUER,
      loginRateLimitMax,
      loginRateLimitWindowMs,
      passwordHash: '',
      refreshRateLimitMax,
      refreshRateLimitWindowMs,
      refreshSecret: '',
      refreshTtlSeconds,
      username: ''
    }
  }

  const username = requireValue(env, 'AUTH_USERNAME')
  const passwordHash = requireValue(env, 'AUTH_PASSWORD_HASH')
  const accessSecret = requireValue(env, 'AUTH_ACCESS_TOKEN_SECRET')
  const refreshSecret = requireValue(env, 'AUTH_REFRESH_TOKEN_SECRET')

  if (username.length > 128) {
    throw new Error('AUTH_USERNAME 不能超过 128 个字符')
  }
  validatePasswordHash(passwordHash)
  validateSecret('AUTH_ACCESS_TOKEN_SECRET', accessSecret)
  validateSecret('AUTH_REFRESH_TOKEN_SECRET', refreshSecret)
  if (accessSecret === refreshSecret) {
    throw new Error('Access Token 与 Refresh Token 必须使用不同 secret')
  }
  if (production && !cookieSecure) {
    throw new Error('production 必须启用 AUTH_COOKIE_SECURE')
  }
  if (production && options.httpsEnabled === false) {
    throw new Error('production 启用认证时必须同时启用 HTTPS')
  }

  return {
    accessSecret,
    accessTtlSeconds,
    allowedOrigins,
    audience: env.AUTH_JWT_AUDIENCE?.trim() || DEFAULT_AUDIENCE,
    cookieName: REFRESH_COOKIE_NAME,
    cookieSecure,
    databasePath,
    enabled,
    issuer: env.AUTH_JWT_ISSUER?.trim() || DEFAULT_ISSUER,
    loginRateLimitMax,
    loginRateLimitWindowMs,
    passwordHash,
    refreshRateLimitMax,
    refreshRateLimitWindowMs,
    refreshSecret,
    refreshTtlSeconds,
    username
  }
}

export { getAuthConfig }
export type { AuthConfig, AuthConfigOptions }
