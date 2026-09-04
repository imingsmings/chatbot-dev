import { createHash } from 'node:crypto'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { getAuthConfig } from '../config/authConfig.ts'
import type { Request } from 'express'

function usernameDigest(request: Request): string {
  const username = typeof request.body?.username === 'string'
    ? request.body.username.trim()
    : ''
  return createHash('sha256').update(username).digest('hex').slice(0, 16)
}

function createLoginRateLimit() {
  const config = getAuthConfig()
  return rateLimit({
    legacyHeaders: false,
    limit: config.loginRateLimitMax,
    windowMs: config.loginRateLimitWindowMs,
    skip: () => !config.enabled,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    keyGenerator: (request) => `${ipKeyGenerator(request.ip ?? 'unknown')}:${usernameDigest(request)}`,
    handler: (request, response) => {
      response.status(429).json({
        code: 'rate_limited',
        message: '登录尝试过多，请稍后重试'
      })
    }
  })
}

function createRefreshRateLimit() {
  const config = getAuthConfig()
  return rateLimit({
    legacyHeaders: false,
    limit: config.refreshRateLimitMax,
    windowMs: config.refreshRateLimitWindowMs,
    skip: () => !config.enabled,
    standardHeaders: 'draft-8',
    keyGenerator: (request) => ipKeyGenerator(request.ip ?? 'unknown'),
    handler: (request, response) => {
      response.status(429).json({
        code: 'rate_limited',
        message: '认证刷新过于频繁，请稍后重试'
      })
    }
  })
}

export { createLoginRateLimit, createRefreshRateLimit }
