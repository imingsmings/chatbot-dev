import { createHash } from 'node:crypto'
import { getAuthConfig } from '../config/authConfig.ts'
import type { HttpRequest, RequestHandler } from '../http/types.ts'

type RateLimitEntry = {
  count: number
  resetAt: number
}

const MAX_RATE_LIMIT_ENTRIES = 4096

function pruneRateLimitEntries(entries: Map<string, RateLimitEntry>, now: number): void {
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) entries.delete(key)
  }
  while (entries.size >= MAX_RATE_LIMIT_ENTRIES) {
    const oldestKey = entries.keys().next().value
    if (oldestKey === undefined) break
    entries.delete(oldestKey)
  }
}

function usernameDigest(request: HttpRequest): string {
  const body = request.body as { username?: unknown }
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  return createHash('sha256').update(username).digest('hex').slice(0, 16)
}

function createRateLimit(options: {
  key: (request: HttpRequest) => string
  limit: number
  message: string
  skip: () => boolean
  skipSuccessfulRequests?: boolean
  windowMs: number
}): RequestHandler {
  const entries = new Map<string, RateLimitEntry>()

  return (request, response, next) => {
    if (options.skip()) {
      next()
      return
    }

    const now = Date.now()
    const key = options.key(request)
    let entry = entries.get(key)
    if (!entry || entry.resetAt <= now) {
      if (entries.size >= MAX_RATE_LIMIT_ENTRIES) {
        pruneRateLimitEntries(entries, now)
      }
      entry = { count: 0, resetAt: now + options.windowMs }
      entries.set(key, entry)
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    if (entry.count >= options.limit) {
      response.setHeader('Retry-After', retryAfterSeconds)
      response.setHeader(
        'RateLimit',
        `limit=${options.limit}, remaining=0, reset=${retryAfterSeconds}`,
      )
      response.status(429).json({
        code: 'rate_limited',
        message: options.message,
      })
      return
    }

    entry.count += 1
    response.setHeader(
      'RateLimit',
      `limit=${options.limit}, remaining=${Math.max(0, options.limit - entry.count)}, reset=${retryAfterSeconds}`,
    )
    if (options.skipSuccessfulRequests) {
      response.onFinish((statusCode) => {
        if (statusCode < 400) entry.count = Math.max(0, entry.count - 1)
      })
    }
    next()
  }
}

function createLoginRateLimit(): RequestHandler {
  const config = getAuthConfig()
  return createRateLimit({
    key: (request) => `${request.ip}:${usernameDigest(request)}`,
    limit: config.loginRateLimitMax,
    message: '登录尝试过多，请稍后重试',
    skip: () => !config.enabled,
    skipSuccessfulRequests: true,
    windowMs: config.loginRateLimitWindowMs,
  })
}

function createRefreshRateLimit(): RequestHandler {
  const config = getAuthConfig()
  return createRateLimit({
    key: (request) => request.ip,
    limit: config.refreshRateLimitMax,
    message: '认证刷新过于频繁，请稍后重试',
    skip: () => !config.enabled,
    windowMs: config.refreshRateLimitWindowMs,
  })
}

export { createLoginRateLimit, createRefreshRateLimit }
