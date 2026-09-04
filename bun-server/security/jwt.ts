import { randomUUID } from 'node:crypto'
import { errors, jwtVerify, SignJWT, type JWTPayload } from 'jose'
import type { AuthConfig } from '../config/authConfig.ts'
import { AuthError } from './authErrors.ts'

type AccessClaims = JWTPayload & {
  jti: string
  sid: string
  sub: string
  token_use: 'access'
}

type RefreshClaims = JWTPayload & {
  family_id: string
  jti: string
  sid: string
  sub: string
  token_use: 'refresh'
}

type SignedToken<T> = {
  claims: T
  expiresAt: number
  token: string
}

const encoder = new TextEncoder()

function assertStringClaim(payload: JWTPayload, name: string): string {
  const value = payload[name]
  if (typeof value !== 'string' || !value) {
    throw new AuthError('invalid_token', '认证令牌无效')
  }
  return value
}

async function signToken(
  claims: Record<string, string>,
  subject: string,
  secret: string,
  expiresAt: number,
  config: AuthConfig,
  issuedAt: number
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(subject)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(encoder.encode(secret))
}

async function signAccessToken(
  subject: string,
  sid: string,
  config: AuthConfig,
  issuedAt = Math.floor(Date.now() / 1000)
): Promise<SignedToken<AccessClaims>> {
  const jti = randomUUID()
  const expiresAt = issuedAt + config.accessTtlSeconds
  const token = await signToken(
    { jti, sid, token_use: 'access' },
    subject,
    config.accessSecret,
    expiresAt,
    config,
    issuedAt
  )
  return {
    claims: { jti, sid, sub: subject, token_use: 'access' },
    expiresAt,
    token
  }
}

async function signRefreshToken(
  subject: string,
  sid: string,
  familyId: string,
  expiresAt: number,
  config: AuthConfig,
  issuedAt = Math.floor(Date.now() / 1000)
): Promise<SignedToken<RefreshClaims>> {
  const jti = randomUUID()
  const token = await signToken(
    { family_id: familyId, jti, sid, token_use: 'refresh' },
    subject,
    config.refreshSecret,
    expiresAt,
    config,
    issuedAt
  )
  return {
    claims: {
      family_id: familyId,
      jti,
      sid,
      sub: subject,
      token_use: 'refresh'
    },
    expiresAt,
    token
  }
}

async function verifyJwt(
  token: string,
  secret: string,
  expectedUse: 'access' | 'refresh',
  config: AuthConfig
): Promise<JWTPayload> {
  try {
    const result = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ['HS256'],
      audience: config.audience,
      issuer: config.issuer,
      typ: 'JWT'
    })
    if (result.payload.token_use !== expectedUse) {
      throw new AuthError('invalid_token', '认证令牌无效')
    }
    return result.payload
  } catch (error) {
    if (error instanceof AuthError) throw error
    if (error instanceof errors.JWTExpired) {
      throw new AuthError('token_expired', '认证已过期', 401, { cause: error })
    }
    throw new AuthError('invalid_token', '认证令牌无效', 401, { cause: error })
  }
}

async function verifyAccessToken(token: string, config: AuthConfig): Promise<AccessClaims> {
  const payload = await verifyJwt(token, config.accessSecret, 'access', config)
  return {
    ...payload,
    jti: assertStringClaim(payload, 'jti'),
    sid: assertStringClaim(payload, 'sid'),
    sub: assertStringClaim(payload, 'sub'),
    token_use: 'access'
  }
}

async function verifyRefreshToken(token: string, config: AuthConfig): Promise<RefreshClaims> {
  const payload = await verifyJwt(token, config.refreshSecret, 'refresh', config)
  return {
    ...payload,
    family_id: assertStringClaim(payload, 'family_id'),
    jti: assertStringClaim(payload, 'jti'),
    sid: assertStringClaim(payload, 'sid'),
    sub: assertStringClaim(payload, 'sub'),
    token_use: 'refresh'
  }
}

export {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
}
export type { AccessClaims, RefreshClaims, SignedToken }
