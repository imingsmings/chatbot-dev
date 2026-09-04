import { randomUUID } from 'node:crypto'
import { getAuthConfig, type AuthConfig } from '../config/authConfig.ts'
import { AuthError } from '../security/authErrors.ts'
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  type AccessClaims
} from '../security/jwt.ts'
import { verifyPassword } from '../security/password.ts'
import {
  createAuthSession,
  isAuthSessionActive,
  revokeAuthSession,
  rotateRefreshToken
} from '../utils/authSessionStore.ts'

type AuthTokens = {
  accessExpiresAt: number
  accessToken: string
  refreshExpiresAt: number
  refreshToken: string
}

async function createLoginSession(
  username: unknown,
  password: unknown,
  config = getAuthConfig(),
  now = Math.floor(Date.now() / 1000)
): Promise<AuthTokens> {
  if (!config.enabled) {
    throw new AuthError('auth_disabled', '认证未启用', 404)
  }

  const suppliedUsername = typeof username === 'string' ? username.trim() : ''
  const suppliedPassword = typeof password === 'string' ? password : ''
  let passwordMatches = false
  try {
    passwordMatches = await verifyPassword(config.passwordHash, suppliedPassword)
  } catch (error) {
    throw new AuthError('auth_unavailable', '认证服务暂时不可用', 503, { cause: error })
  }
  if (suppliedUsername !== config.username || !passwordMatches) {
    throw new AuthError('invalid_credentials', '用户名或密码错误')
  }

  const sid = randomUUID()
  const familyId = randomUUID()
  const refreshExpiresAt = now + config.refreshTtlSeconds
  const [access, refresh] = await Promise.all([
    signAccessToken(config.username, sid, config, now),
    signRefreshToken(config.username, sid, familyId, refreshExpiresAt, config, now)
  ])
  createAuthSession(config, {
    expiresAt: refreshExpiresAt,
    familyId,
    issuedAt: now,
    jti: refresh.claims.jti,
    sid,
    subject: config.username
  })

  return {
    accessExpiresAt: access.expiresAt,
    accessToken: access.token,
    refreshExpiresAt,
    refreshToken: refresh.token
  }
}

async function refreshLoginSession(
  token: string,
  config = getAuthConfig(),
  now = Math.floor(Date.now() / 1000)
): Promise<AuthTokens> {
  if (!config.enabled) {
    throw new AuthError('auth_disabled', '认证未启用', 404)
  }
  if (!token) throw new AuthError('refresh_required', '登录状态已失效')

  const current = await verifyRefreshToken(token, config)
  const sessionExpiresAt = Number(current.exp)
  if (!Number.isInteger(sessionExpiresAt) || sessionExpiresAt <= now) {
    throw new AuthError('token_expired', '登录状态已过期')
  }
  const nextRefresh = await signRefreshToken(
    current.sub,
    current.sid,
    current.family_id,
    sessionExpiresAt,
    config,
    now
  )
  const rotation = rotateRefreshToken(config, {
    currentJti: current.jti,
    familyId: current.family_id,
    issuedAt: now,
    newJti: nextRefresh.claims.jti,
    sid: current.sid
  })
  if (rotation.status !== 'rotated') {
    const code = rotation.status === 'replayed' ? 'refresh_replayed' : 'session_revoked'
    throw new AuthError(code, '登录状态已失效')
  }

  const access = await signAccessToken(current.sub, current.sid, config, now)
  return {
    accessExpiresAt: access.expiresAt,
    accessToken: access.token,
    refreshExpiresAt: rotation.sessionExpiresAt,
    refreshToken: nextRefresh.token
  }
}

async function authenticateAccessToken(
  token: string,
  config = getAuthConfig()
): Promise<AccessClaims> {
  const claims = await verifyAccessToken(token, config)
  if (!isAuthSessionActive(config, claims.sid, claims.sub)) {
    throw new AuthError('session_revoked', '登录状态已失效')
  }
  return claims
}

async function logoutSession(
  token: string | undefined,
  config = getAuthConfig()
): Promise<void> {
  if (!config.enabled || !token) return
  try {
    const claims = await verifyRefreshToken(token, config)
    revokeAuthSession(config, claims.sid, 'logout')
  } catch (error) {
    if (!(error instanceof AuthError)) throw error
  }
}

function extractBearerToken(value: string | undefined): string {
  const match = value?.match(/^Bearer ([^\s]+)$/)
  if (!match?.[1]) throw new AuthError('auth_required', '需要登录')
  return match[1]
}

function toPublicAuthTokens(tokens: AuthTokens) {
  return {
    accessToken: tokens.accessToken,
    expiresAt: tokens.accessExpiresAt * 1000
  }
}

export {
  authenticateAccessToken,
  createLoginSession,
  extractBearerToken,
  logoutSession,
  refreshLoginSession,
  toPublicAuthTokens
}
export type { AuthTokens }
