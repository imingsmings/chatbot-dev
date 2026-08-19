import { getAuthConfig } from '../config/authConfig.ts'
import { isAllowedAuthOrigin } from '../security/origin.ts'
import type { RequestHandler } from 'express'

const requireAuthOrigin: RequestHandler = (request, response, next) => {
  try {
    const config = getAuthConfig()
    if (!config.enabled || isAllowedAuthOrigin(request, config)) {
      next()
      return
    }
    response.status(403).json({
      code: 'invalid_origin',
      message: '请求来源无效'
    })
  } catch {
    response.status(503).json({
      code: 'auth_unavailable',
      message: '认证服务暂时不可用'
    })
  }
}

export { requireAuthOrigin }
