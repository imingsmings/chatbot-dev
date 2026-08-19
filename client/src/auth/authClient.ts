export type AuthSnapshot = {
  error: string | null
  loggingIn: boolean
  loggingOut: boolean
  retryAfterSeconds: number | null
  status: 'checking' | 'disabled' | 'authenticated' | 'unauthenticated' | 'error'
}

type AuthTokenResponse = {
  accessToken: string
  expiresAt: number
}

type AuthBroadcastMessage =
  | { type: 'logout' }
  | { type: 'token'; accessToken: string; expiresAt: number }

type BrowserNavigator = Navigator & {
  locks?: LockManager
}

const REFRESH_EARLY_MS = 30_000
const AUTH_CHANNEL_NAME = 'chatbot-auth-session'
const REFRESH_LOCK_NAME = 'chatbot-auth-refresh'

class AuthClientError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'AuthClientError'
    this.code = code
    this.status = status
  }
}

function initialSnapshot(): AuthSnapshot {
  return {
    error: null,
    loggingIn: false,
    loggingOut: false,
    retryAfterSeconds: null,
    status: 'checking',
  }
}

export class AuthClient {
  private accessExpiresAt = 0
  private accessToken: string | null = null
  private readonly channel: BroadcastChannel | null
  private initializePromise: Promise<void> | null = null
  private readonly listeners = new Set<() => void>()
  private refreshPromise: Promise<string> | null = null
  private refreshTimer: number | null = null
  private snapshot = initialSnapshot()

  private readonly fetchImplementation: typeof fetch

  constructor(fetchImplementation?: typeof fetch) {
    this.fetchImplementation = fetchImplementation ?? ((input, init) => (
      init === undefined ? globalThis.fetch(input) : globalThis.fetch(input, init)
    ))
    this.channel = typeof window !== 'undefined' && typeof BroadcastChannel === 'function'
      ? new BroadcastChannel(AUTH_CHANNEL_NAME)
      : null
    this.channel?.addEventListener('message', this.handleBroadcast)
  }

  private readonly handleBroadcast = (event: MessageEvent<AuthBroadcastMessage>) => {
    if (event.data?.type === 'logout') {
      this.clearToken()
      this.setSnapshot({
        error: '登录状态已失效，请重新登录',
        loggingIn: false,
        loggingOut: false,
        retryAfterSeconds: null,
        status: 'unauthenticated',
      })
      return
    }
    if (event.data?.type === 'token') {
      this.setToken(event.data.accessToken, event.data.expiresAt, false)
    }
  }

  private setSnapshot(next: AuthSnapshot) {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  private updateSnapshot(patch: Partial<AuthSnapshot>) {
    this.setSnapshot({ ...this.snapshot, ...patch })
  }

  private clearRefreshTimer() {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private clearToken() {
    this.accessToken = null
    this.accessExpiresAt = 0
    this.clearRefreshTimer()
  }

  private setToken(accessToken: string, expiresAt: number, broadcast = true) {
    this.accessToken = accessToken
    this.accessExpiresAt = expiresAt
    this.clearRefreshTimer()
    const refreshDelay = Math.max(expiresAt - Date.now() - REFRESH_EARLY_MS, 1000)
    this.refreshTimer = window.setTimeout(() => {
      void this.refresh().catch(() => undefined)
    }, refreshDelay)
    this.setSnapshot({
      error: null,
      loggingIn: false,
      loggingOut: false,
      retryAfterSeconds: null,
      status: 'authenticated',
    })
    if (broadcast) {
      this.channel?.postMessage({ type: 'token', accessToken, expiresAt } satisfies AuthBroadcastMessage)
    }
  }

  private async readAuthError(response: Response): Promise<AuthClientError> {
    const payload = await response.clone().json().catch(() => null) as {
      code?: string
      message?: string
    } | null
    return new AuthClientError(
      payload?.code || 'auth_failed',
      payload?.message || `认证请求失败：${response.status}`,
      response.status,
    )
  }

  private async readTokenResponse(response: Response): Promise<AuthTokenResponse> {
    if (!response.ok) throw await this.readAuthError(response)
    const payload = await response.json().catch(() => null) as Partial<AuthTokenResponse> | null
    if (
      typeof payload?.accessToken !== 'string' ||
      !payload.accessToken ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= Date.now()
    ) {
      throw new AuthClientError('invalid_auth_response', '认证服务返回了无效响应', 502)
    }
    return { accessToken: payload.accessToken, expiresAt: payload.expiresAt }
  }

  async initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise
    this.initializePromise = (async () => {
      this.updateSnapshot({ error: null, status: 'checking' })
      try {
        const statusResponse = await this.fetchImplementation('/api/auth/status', {
          credentials: 'same-origin',
        })
        if (statusResponse.status === 404) {
          this.clearToken()
          this.updateSnapshot({ status: 'disabled' })
          return
        }
        if (!statusResponse.ok) throw await this.readAuthError(statusResponse)
        const status = await statusResponse.json().catch(() => null) as { enabled?: boolean } | null
        if (status?.enabled !== true) {
          this.clearToken()
          this.updateSnapshot({ status: 'disabled' })
          return
        }
        try {
          await this.refresh()
        } catch (error) {
          if (error instanceof AuthClientError && [401, 403].includes(error.status)) {
            this.clearToken()
            this.updateSnapshot({
              error: null,
              retryAfterSeconds: null,
              status: 'unauthenticated',
            })
            return
          }
          throw error
        }
      } catch (error) {
        this.clearToken()
        this.updateSnapshot({
          error: error instanceof Error ? error.message : '无法连接认证服务',
          status: 'error',
        })
      }
    })().finally(() => {
      this.initializePromise = null
    })
    return this.initializePromise
  }

  async login(username: string, password: string): Promise<void> {
    if (this.snapshot.loggingIn) return
    this.updateSnapshot({
      error: null,
      loggingIn: true,
      retryAfterSeconds: null,
    })
    try {
      const response = await this.fetchImplementation('/api/auth/login', {
        body: JSON.stringify({ username, password }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) {
        const error = await this.readAuthError(response)
        const retryAfter = Number(response.headers.get('Retry-After'))
        this.updateSnapshot({
          error: error.message,
          loggingIn: false,
          retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
          status: 'unauthenticated',
        })
        throw error
      }
      const token = await this.readTokenResponse(response)
      this.setToken(token.accessToken, token.expiresAt)
    } catch (error) {
      if (this.snapshot.loggingIn) {
        this.updateSnapshot({
          error: error instanceof Error ? error.message : '登录失败',
          loggingIn: false,
          status: 'unauthenticated',
        })
      }
      throw error
    }
  }

  private async performRefresh(): Promise<string> {
    if (this.accessToken && this.accessExpiresAt - Date.now() > REFRESH_EARLY_MS) {
      return this.accessToken
    }
    const response = await this.fetchImplementation('/api/auth/refresh', {
      credentials: 'same-origin',
      method: 'POST',
    })
    const token = await this.readTokenResponse(response)
    this.setToken(token.accessToken, token.expiresAt)
    return token.accessToken
  }

  async refresh(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise
    const run = async () => this.performRefresh()
    const locks = (navigator as BrowserNavigator).locks
    this.refreshPromise = (locks
      ? locks.request(REFRESH_LOCK_NAME, run)
      : run()
    ).catch((error) => {
      if (error instanceof AuthClientError && [401, 403].includes(error.status)) {
        this.clearToken()
        this.setSnapshot({
          error: '登录状态已失效，请重新登录',
          loggingIn: false,
          loggingOut: false,
          retryAfterSeconds: null,
          status: 'unauthenticated',
        })
        this.channel?.postMessage({ type: 'logout' } satisfies AuthBroadcastMessage)
      }
      throw error
    }).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  async logout(): Promise<void> {
    if (this.snapshot.loggingOut) return
    this.updateSnapshot({ loggingOut: true })
    let logoutError: string | null = null
    try {
      const response = await this.fetchImplementation('/api/auth/logout', {
        credentials: 'same-origin',
        method: 'POST',
      })
      if (!response.ok) throw await this.readAuthError(response)
    } catch (error) {
      logoutError = error instanceof Error
        ? `服务端注销失败：${error.message}`
        : '服务端注销失败，请稍后重试'
    } finally {
      this.clearToken()
      this.setSnapshot({
        error: logoutError,
        loggingIn: false,
        loggingOut: false,
        retryAfterSeconds: null,
        status: 'unauthenticated',
      })
      this.channel?.postMessage({ type: 'logout' } satisfies AuthBroadcastMessage)
    }
  }

  async request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (this.snapshot.status === 'disabled' || this.snapshot.status === 'checking') {
      return init === undefined
        ? this.fetchImplementation(input)
        : this.fetchImplementation(input, init)
    }
    if (this.snapshot.status !== 'authenticated') {
      throw new AuthClientError('auth_required', '需要登录', 401)
    }

    const send = async (token: string) => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${token}`)
      return this.fetchImplementation(input, { ...init, headers })
    }
    let token = this.accessToken
    if (!token || this.accessExpiresAt - Date.now() <= REFRESH_EARLY_MS) {
      token = await this.refresh()
    }
    let response = await send(token)
    if (response.status !== 401 || init?.signal?.aborted) return response

    this.clearToken()
    token = await this.refresh()
    response = await send(token)
    return response
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose() {
    this.clearRefreshTimer()
    this.channel?.removeEventListener('message', this.handleBroadcast)
    this.channel?.close()
    this.listeners.clear()
  }
}

export const authClient = new AuthClient()
export { AuthClientError }
