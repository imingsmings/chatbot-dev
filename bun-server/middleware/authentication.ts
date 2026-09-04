import { getAuthConfig } from '../config/authConfig.ts'
import { AuthError } from '../security/authErrors.ts'
import { authenticateAccessToken, extractBearerToken } from '../services/authService.ts'
import type { RequestHandler } from 'express'

const requireAuthentication: RequestHandler = async (request, response, next) => {
  let config
  try {
    config = getAuthConfig()
    if (!config.enabled) {
      next()
      return
    }
    const token = extractBearerToken(request.get('authorization'))
    response.locals.auth = await authenticateAccessToken(token, config)
    next()
  } catch (error) {
    const authError = error instanceof AuthError
      ? error
      : new AuthError('auth_unavailable', '认证服务暂时不可用', 503, { cause: error })
    if (authError.status === 401) {
      response.setHeader('WWW-Authenticate', 'Bearer')
    }
    response.status(authError.status).json({
      code: authError.code,
      message: authError.message
    })
  }
}

export { requireAuthentication }
