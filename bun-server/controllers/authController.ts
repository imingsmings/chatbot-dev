import { getAuthConfig } from '../config/authConfig.ts'
import { AuthError } from '../security/authErrors.ts'
import {
  createLoginSession,
  logoutSession,
  refreshLoginSession,
  toPublicAuthTokens
} from '../services/authService.ts'
import type { CookieOptions, HttpResponse, RequestHandler } from '../http/types.ts'

function refreshCookieOptions(maxAge?: number): CookieOptions {
  const config = getAuthConfig()
  return {
    httpOnly: true,
    path: '/api/auth',
    sameSite: 'strict',
    secure: config.cookieSecure,
    ...(maxAge === undefined ? {} : { maxAge })
  }
}

function sendAuthError(response: HttpResponse, error: unknown): void {
  const authError = error instanceof AuthError
    ? error
    : new AuthError('auth_unavailable', '认证服务暂时不可用', 503, { cause: error })
  response.status(authError.status).json({
    code: authError.code,
    message: authError.message
  })
}

const getAuthStatus: RequestHandler = (request, response) => {
  try {
    response.json({ enabled: getAuthConfig().enabled })
  } catch (error) {
    sendAuthError(response, error)
  }
}

const login: RequestHandler<Record<string, string>, unknown, {
  password?: unknown
  username?: unknown
}> = async (request, response) => {
  try {
    const config = getAuthConfig()
    const tokens = await createLoginSession(
      request.body?.username,
      request.body?.password,
      config
    )
    response.cookie(
      config.cookieName,
      tokens.refreshToken,
      refreshCookieOptions((tokens.refreshExpiresAt * 1000) - Date.now())
    )
    response.json(toPublicAuthTokens(tokens))
  } catch (error) {
    sendAuthError(response, error)
  }
}

const refresh: RequestHandler = async (request, response) => {
  let config
  try {
    config = getAuthConfig()
    const tokens = await refreshLoginSession(request.cookies?.[config.cookieName] ?? '', config)
    response.cookie(
      config.cookieName,
      tokens.refreshToken,
      refreshCookieOptions((tokens.refreshExpiresAt * 1000) - Date.now())
    )
    response.json(toPublicAuthTokens(tokens))
  } catch (error) {
    if (config) response.clearCookie(config.cookieName, refreshCookieOptions())
    sendAuthError(response, error)
  }
}

const logout: RequestHandler = async (request, response) => {
  try {
    const config = getAuthConfig()
    await logoutSession(request.cookies?.[config.cookieName], config)
    response.clearCookie(config.cookieName, refreshCookieOptions())
    response.status(204).end()
  } catch (error) {
    sendAuthError(response, error)
  }
}

export { getAuthStatus, login, logout, refresh }
