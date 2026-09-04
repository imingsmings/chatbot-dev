import express from 'express'
import { getAuthStatus, login, logout, refresh } from '../controllers/authController.ts'
import { requireAuthOrigin } from '../middleware/authOrigin.ts'
import { createLoginRateLimit, createRefreshRateLimit } from '../middleware/authRateLimits.ts'

const router = express.Router()
const loginRateLimit = createLoginRateLimit()
const refreshRateLimit = createRefreshRateLimit()

router.get('/auth/status', getAuthStatus)
router.post('/auth/login', requireAuthOrigin, loginRateLimit, login)
router.post('/auth/refresh', requireAuthOrigin, refreshRateLimit, refresh)
router.post('/auth/logout', requireAuthOrigin, refreshRateLimit, logout)

export default router
