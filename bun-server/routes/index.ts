import express from 'express'
import authRoutes from './auth.ts'
import chatRoutes from './chat.ts'
import conversationRoutes from './conversations.ts'
import healthRoutes from './health.ts'
import legacyRoutes from './legacy.ts'
import requestRoutes from './requests.ts'
import runtimeRoutes from './runtime.ts'
import { requireAuthentication } from '../middleware/authentication.ts'

const router = express.Router()
const protectedRouter = express.Router()

router.use(healthRoutes)
router.use(authRoutes)
router.use(requireAuthentication)
router.use(protectedRouter)

protectedRouter.use(conversationRoutes)
protectedRouter.use(chatRoutes)
protectedRouter.use(requestRoutes)
protectedRouter.use(runtimeRoutes)
protectedRouter.use(legacyRoutes)

export default router
export { protectedRouter }
