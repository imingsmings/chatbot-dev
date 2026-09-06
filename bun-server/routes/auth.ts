import { getAuthStatus, login, logout, refresh } from '../controllers/authController.ts'
import { defineRoute } from '../http/router.ts'
import { requireAuthOrigin } from '../middleware/authOrigin.ts'
import { createLoginRateLimit, createRefreshRateLimit } from '../middleware/authRateLimits.ts'

function createAuthRoutes() {
  const loginRateLimit = createLoginRateLimit()
  const refreshRateLimit = createRefreshRateLimit()
  return [
    defineRoute('GET', '/auth/status', getAuthStatus),
    defineRoute('POST', '/auth/login', [requireAuthOrigin, loginRateLimit, login], 'json'),
    defineRoute('POST', '/auth/refresh', [requireAuthOrigin, refreshRateLimit, refresh], 'json'),
    defineRoute('POST', '/auth/logout', [requireAuthOrigin, refreshRateLimit, logout], 'json'),
  ]
}

export { createAuthRoutes }
