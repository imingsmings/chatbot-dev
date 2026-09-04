import type { AuthConfig } from '../config/authConfig.ts'
import type { Request } from 'express'

function isAllowedAuthOrigin(request: Request, config: AuthConfig): boolean {
  const origin = request.get('origin')
  if (!origin) return false

  let normalizedOrigin: string
  try {
    normalizedOrigin = new URL(origin).origin
  } catch {
    return false
  }

  if (config.allowedOrigins.has(normalizedOrigin)) return true
  return normalizedOrigin === `${request.protocol}://${request.get('host')}`
}

export { isAllowedAuthOrigin }
