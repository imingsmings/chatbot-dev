type NextFunction = (error?: unknown) => void

type CookieOptions = {
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: 'strict' | 'lax' | 'none'
  secure?: boolean
}

type RequestEvent = 'aborted'
type ResponseEvent = 'close'

type HttpRequest<
  Params = Record<string, string>,
  Body = unknown,
  Query = Record<string, string>,
> = {
  body: Body
  cookies: Record<string, string>
  ip: string
  method: string
  params: Params
  path: string
  protocol: string
  query: Query
  raw: Request
  get: (name: string) => string | undefined
  off: (event: RequestEvent, listener: () => void) => void
  on: (event: RequestEvent, listener: () => void) => void
}

type RequestHandler<
  Params = Record<string, string>,
  ResponseBody = unknown,
  RequestBody = unknown,
  Query = Record<string, string>,
> = (
  request: HttpRequest<Params, RequestBody, Query>,
  response: HttpResponse,
  next: NextFunction,
) => ResponseBody | void | Promise<ResponseBody | void>

type HttpBody = BodyInit | Uint8Array<ArrayBufferLike> | null

type HttpResponse = {
  readonly headers: Headers
  readonly locals: Record<string, unknown>
  destroyed: boolean
  headersSent: boolean
  statusCode: number
  writableEnded: boolean
  status: (statusCode: number) => HttpResponse
  setHeader: (name: string, value: string | number | readonly string[]) => HttpResponse
  type: (contentType: string) => HttpResponse
  cookie: (name: string, value: string, options?: CookieOptions) => HttpResponse
  clearCookie: (name: string, options?: CookieOptions) => HttpResponse
  json: (value: unknown) => void
  send: (value: HttpBody) => void
  sendResponse: (response: Response) => void
  startStream: () => void
  write: (value: string | Uint8Array) => Promise<boolean>
  end: (value?: HttpBody) => Promise<void>
  on: (event: ResponseEvent, listener: () => void) => void
  off: (event: ResponseEvent, listener: () => void) => void
  onFinish: (listener: (statusCode: number) => void) => void
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`]
  if (options.maxAge !== undefined) {
    const maxAgeSeconds = Math.max(0, Math.floor(options.maxAge / 1000))
    parts.push(`Max-Age=${maxAgeSeconds}`)
    parts.push(`Expires=${new Date(Date.now() + options.maxAge).toUTCString()}`)
  }
  if (options.path) parts.push(`Path=${options.path}`)
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite[0]?.toUpperCase()}${options.sameSite.slice(1)}`)
  }
  return parts.join('; ')
}

class BunHttpResponse implements HttpResponse {
  readonly headers = new Headers()
  readonly locals: Record<string, unknown> = {}
  destroyed = false
  headersSent = false
  statusCode = 200
  writableEnded = false

  readonly #closeListeners = new Set<() => void>()
  readonly #finishListeners = new Set<(statusCode: number) => void>()
  readonly #ready: Promise<Response>
  #resolveReady!: (response: Response) => void
  #responseCommitted = false
  #writer: WritableStreamDefaultWriter<Uint8Array> | null = null

  constructor(request: HttpRequest<Record<string, string>, unknown, Record<string, string>>) {
    this.#ready = new Promise<Response>((resolve) => {
      this.#resolveReady = resolve
    })
    request.raw.signal.addEventListener('abort', () => this.#handleClose(), { once: true })
  }

  status(statusCode: number): this {
    this.statusCode = statusCode
    return this
  }

  setHeader(name: string, value: string | number | readonly string[]): this {
    if (this.headersSent) {
      throw new Error('响应头已经发送')
    }
    this.headers.delete(name)
    if (Array.isArray(value)) {
      for (const item of value) this.headers.append(name, item)
    } else {
      this.headers.set(name, String(value))
    }
    return this
  }

  type(contentType: string): this {
    this.setHeader('Content-Type', contentType)
    return this
  }

  cookie(name: string, value: string, options: CookieOptions = {}): this {
    this.headers.append('Set-Cookie', serializeCookie(name, value, options))
    return this
  }

  clearCookie(name: string, options: CookieOptions = {}): this {
    this.headers.append('Set-Cookie', serializeCookie(name, '', {
      ...options,
      maxAge: 0,
    }))
    return this
  }

  json(value: unknown): void {
    if (!this.headers.has('Content-Type')) {
      this.headers.set('Content-Type', 'application/json; charset=utf-8')
    }
    this.#commit(JSON.stringify(value), true)
  }

  send(value: HttpBody): void {
    if (!this.headers.has('Content-Type')) {
      if (typeof value === 'string') {
        this.headers.set('Content-Type', 'text/html; charset=utf-8')
      } else if (value instanceof Blob && value.type) {
        this.headers.set('Content-Type', value.type)
      } else {
        this.headers.set('Content-Type', 'application/octet-stream')
      }
    }
    this.#commit(normalizeBody(value), true)
  }

  sendResponse(response: Response): void {
    for (const [name, value] of response.headers) this.headers.set(name, value)
    this.statusCode = response.status
    this.#commit(response.body, true)
  }

  startStream(): void {
    if (this.#writer || this.#responseCommitted) return

    const stream = new TransformStream<Uint8Array, Uint8Array>()
    this.#writer = stream.writable.getWriter()
    void this.#writer.closed.catch(() => this.#handleClose())
    this.#commit(stream.readable, false)
  }

  async write(value: string | Uint8Array): Promise<boolean> {
    if (this.destroyed || this.writableEnded) return false
    this.startStream()
    const writer = this.#writer
    if (!writer) return false

    try {
      await writer.ready
      await writer.write(typeof value === 'string' ? new TextEncoder().encode(value) : value)
      return true
    } catch {
      this.#handleClose()
      return false
    }
  }

  async end(value?: HttpBody): Promise<void> {
    if (this.writableEnded) return
    this.writableEnded = true

    if (!this.#writer) {
      this.#commit(normalizeBody(value ?? null), true)
      return
    }

    try {
      await this.#writer.close()
    } catch {
      this.#handleClose()
    } finally {
      this.#finish()
    }
  }

  on(event: ResponseEvent, listener: () => void): void {
    if (event === 'close') this.#closeListeners.add(listener)
  }

  off(event: ResponseEvent, listener: () => void): void {
    if (event === 'close') this.#closeListeners.delete(listener)
  }

  onFinish(listener: (statusCode: number) => void): void {
    this.#finishListeners.add(listener)
  }

  waitUntilReady(): Promise<Response> {
    return this.#ready
  }

  #commit(body: BodyInit | null, finished: boolean): void {
    if (this.#responseCommitted) return
    this.#responseCommitted = true
    this.headersSent = true
    if (finished) this.writableEnded = true
    this.#resolveReady(new Response(body, {
      headers: this.headers,
      status: this.statusCode,
    }))
    if (finished) this.#finish()
  }

  #finish(): void {
    for (const listener of this.#finishListeners) listener(this.statusCode)
    this.#finishListeners.clear()
    for (const listener of this.#closeListeners) listener()
    this.#closeListeners.clear()
  }

  #handleClose(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const listener of this.#closeListeners) listener()
    this.#closeListeners.clear()
  }
}

function normalizeBody(value: HttpBody): BodyInit | null {
  if (value instanceof Uint8Array) return new Uint8Array(value)
  return value
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {}
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    if (!name) continue
    const value = part.slice(separator + 1).trim()
    try {
      cookies[decodeURIComponent(name)] = decodeURIComponent(value)
    } catch {
      cookies[name] = value
    }
  }
  return cookies
}

function createHttpRequest(
  raw: Request,
  server?: BunRuntime.Server,
): HttpRequest<Record<string, string>, unknown, Record<string, string>> {
  const url = new URL(raw.url)
  const abortListeners = new Set<() => void>()
  const handleAbort = (): void => {
    for (const listener of abortListeners) listener()
    abortListeners.clear()
  }
  raw.signal.addEventListener('abort', handleAbort, { once: true })

  return {
    body: {},
    cookies: parseCookies(raw.headers.get('cookie')),
    get: (name) => raw.headers.get(name) ?? undefined,
    ip: server?.requestIP(raw)?.address ?? 'unknown',
    method: raw.method.toUpperCase(),
    off: (_event, listener) => abortListeners.delete(listener),
    on: (_event, listener) => abortListeners.add(listener),
    params: {},
    path: url.pathname,
    protocol: url.protocol.replace(/:$/, ''),
    query: Object.fromEntries(url.searchParams),
    raw,
  }
}

export { BunHttpResponse, createHttpRequest }
export type { CookieOptions, HttpRequest, HttpResponse, NextFunction, RequestHandler }
