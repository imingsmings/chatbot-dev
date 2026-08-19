import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthClient } from '../../../client/src/auth/authClient'

const clients: AuthClient[] = []

function createClient(fetchImplementation: typeof fetch) {
  const client = new AuthClient(fetchImplementation)
  clients.push(client)
  return client
}

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(payload), {
    headers: responseHeaders,
    status,
  })
}

function tokenResponse(accessToken: string, expiresInMs = 120_000) {
  return jsonResponse({ accessToken, expiresAt: Date.now() + expiresInMs })
}

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose()
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('AuthClient', () => {
  it('keeps compatibility when authentication is disabled or unavailable on an old backend', async () => {
    for (const statusResponse of [
      jsonResponse({ enabled: false }),
      new Response(null, { status: 404 }),
    ]) {
      const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(statusResponse)
      const client = createClient(fetchImplementation)

      await client.initialize()

      expect(client.getSnapshot().status).toBe('disabled')
      await client.request('/api/runtime-config')
      expect(fetchImplementation).toHaveBeenLastCalledWith('/api/runtime-config')
    }
  })

  it('requires login when an enabled service has no valid refresh cookie', async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ enabled: true }))
      .mockResolvedValueOnce(jsonResponse({ code: 'auth_required', message: '需要登录' }, 401))
    const client = createClient(fetchImplementation)

    await client.initialize()

    expect(client.getSnapshot()).toMatchObject({ error: null, status: 'unauthenticated' })
    await expect(client.request('/api/runtime-config')).rejects.toMatchObject({
      code: 'auth_required',
      status: 401,
    })
  })

  it('keeps access tokens only in memory and exposes stable login rate-limit state', async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(
        { code: 'rate_limited', message: '登录尝试过多' },
        429,
        { 'Retry-After': '42' },
      ))
      .mockResolvedValueOnce(tokenResponse('memory-only-token'))
    const client = createClient(fetchImplementation)

    await expect(client.login('tester', 'wrong')).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    })
    expect(client.getSnapshot()).toMatchObject({
      error: '登录尝试过多',
      retryAfterSeconds: 42,
      status: 'unauthenticated',
    })

    await client.login('tester', 'correct')

    expect(client.getSnapshot().status).toBe('authenticated')
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(JSON.stringify(client.getSnapshot())).not.toContain('memory-only-token')
  })

  it('submits only one login request while a login is already pending', async () => {
    let resolveLogin: ((response: Response) => void) | undefined
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(() => (
      new Promise<Response>((resolve) => { resolveLogin = resolve })
    ))
    const client = createClient(fetchImplementation)

    const firstLogin = client.login('tester', 'correct')
    const duplicateLogin = client.login('tester', 'correct')

    await duplicateLogin
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(client.getSnapshot().loggingIn).toBe(true)
    resolveLogin?.(tokenResponse('single-login-token'))
    await firstLogin
    expect(client.getSnapshot().status).toBe('authenticated')
  })

  it('single-flights refresh, replays each failed request once, and preserves request bodies', async () => {
    let refreshCalls = 0
    const resourceCalls: Array<{ authorization: string | null; body: BodyInit | null | undefined }> = []
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      if (input === '/api/auth/login') return tokenResponse('access-one')
      if (input === '/api/auth/refresh') {
        refreshCalls += 1
        return tokenResponse('access-two')
      }
      if (input === '/api/resource') {
        const headers = new Headers(init?.headers)
        resourceCalls.push({
          authorization: headers.get('Authorization'),
          body: init?.body,
        })
        return headers.get('Authorization') === 'Bearer access-one'
          ? jsonResponse({ code: 'token_expired' }, 401)
          : jsonResponse({ ok: true })
      }
      return new Response(null, { status: 404 })
    })
    const client = createClient(fetchImplementation)
    await client.login('tester', 'correct')

    const body = JSON.stringify({ requestId: 'request-1', question: 'hello' })
    const [first, second] = await Promise.all([
      client.request('/api/resource', { body, method: 'POST' }),
      client.request('/api/resource', { body, method: 'POST' }),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(refreshCalls).toBe(1)
    expect(resourceCalls).toHaveLength(4)
    expect(resourceCalls.map((call) => call.authorization)).toEqual([
      'Bearer access-one',
      'Bearer access-one',
      'Bearer access-two',
      'Bearer access-two',
    ])
    expect(resourceCalls.every((call) => call.body === body)).toBe(true)
  })

  it('clears local authentication state even when logout cannot reach the server', async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse('access-one'))
      .mockRejectedValueOnce(new TypeError('network unavailable'))
    const client = createClient(fetchImplementation)
    await client.login('tester', 'correct')

    await expect(client.logout()).resolves.toBeUndefined()

    expect(client.getSnapshot()).toMatchObject({
      error: '服务端注销失败：network unavailable',
      status: 'unauthenticated',
    })
    await expect(client.request('/api/runtime-config')).rejects.toMatchObject({
      code: 'auth_required',
      status: 401,
    })
  })
})
