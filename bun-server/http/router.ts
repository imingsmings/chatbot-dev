import { MAX_PORTABLE_BACKUP_BYTES } from '../config/productLimits.ts'
import type { HttpRequest, HttpResponse, RequestHandler } from './types.ts'

const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024

type BodyParser = 'json' | 'multipart' | 'raw-zip'
type AnyRequestHandler = RequestHandler<any, unknown, any, any>

type RouteDefinition = {
  body?: BodyParser
  handlers: AnyRequestHandler[]
  method: string
  pattern: string
}

class HttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function defineRoute(
  method: string,
  pattern: string,
  handlers: AnyRequestHandler | AnyRequestHandler[],
  body?: BodyParser,
): RouteDefinition {
  return {
    ...(body ? { body } : {}),
    handlers: Array.isArray(handlers) ? handlers : [handlers],
    method: method.toUpperCase(),
    pattern,
  }
}

function matchRoute(
  routes: RouteDefinition[],
  method: string,
  pathname: string,
): { params: Record<string, string>; route: RouteDefinition } | null {
  const requestMethod = method === 'HEAD' ? 'GET' : method
  const pathnameParts = pathname.split('/').filter(Boolean)

  for (const route of routes) {
    if (route.method !== requestMethod) continue
    const patternParts = route.pattern.split('/').filter(Boolean)
    if (patternParts.length !== pathnameParts.length) continue

    const params: Record<string, string> = {}
    let matched = true
    for (let index = 0; index < patternParts.length; index += 1) {
      const patternPart = patternParts[index] ?? ''
      const pathnamePart = pathnameParts[index] ?? ''
      if (patternPart.startsWith(':')) {
        try {
          params[patternPart.slice(1)] = decodeURIComponent(pathnamePart)
        } catch {
          matched = false
          break
        }
      } else if (patternPart !== pathnamePart) {
        matched = false
        break
      }
    }
    if (matched) return { params, route }
  }

  return null
}

async function readRequestBody(request: Request, limit: number): Promise<Buffer> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new HttpError('请求体过大', 413)
  }
  if (!request.body) return Buffer.alloc(0)

  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new HttpError('请求体过大', 413)
      }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    if (request.signal.aborted) throw new HttpError('请求已取消', 499)
    throw error
  }
  return Buffer.concat(chunks, total)
}

async function parseRouteBody(
  request: HttpRequest<Record<string, string>, any, any>,
  parser: BodyParser | undefined,
): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return {}
  if (parser === 'multipart') return {}

  const contentType = request.get('content-type')?.toLowerCase() ?? ''
  if (parser === 'raw-zip') {
    if (!contentType.startsWith('application/zip') && !contentType.startsWith('application/octet-stream')) {
      return undefined
    }
    return readRequestBody(request.raw, MAX_PORTABLE_BACKUP_BYTES)
  }

  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    const body = await readRequestBody(request.raw, MAX_JSON_BODY_BYTES)
    return Object.fromEntries(new URLSearchParams(body.toString('utf8')))
  }
  if (!contentType.includes('application/json') && !contentType.includes('+json')) return {}

  const body = await readRequestBody(request.raw, MAX_JSON_BODY_BYTES)
  if (body.length === 0) return {}
  try {
    return JSON.parse(body.toString('utf8')) as unknown
  } catch {
    throw new HttpError('请求体必须是有效 JSON', 400)
  }
}

async function runRoute(
  match: { params: Record<string, string>; route: RouteDefinition },
  request: HttpRequest<Record<string, string>, any, any>,
  response: HttpResponse,
): Promise<void> {
  request.params = match.params
  request.body = await parseRouteBody(request, match.route.body)

  for (let index = 0; index < match.route.handlers.length; index += 1) {
    const handler = match.route.handlers[index]
    if (!handler) continue
    let nextCalled = false
    let nextError: unknown
    await handler(request, response, (error?: unknown) => {
      nextCalled = true
      nextError = error
    })
    if (nextError !== undefined) throw nextError
    if (response.headersSent || response.writableEnded) return
    if (index < match.route.handlers.length - 1 && !nextCalled) return
  }
}

export {
  HttpError,
  defineRoute,
  matchRoute,
  runRoute,
}
export type { BodyParser, RouteDefinition }
