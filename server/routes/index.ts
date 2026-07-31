import express from 'express'
import chatRoutes from './chat.ts'
import conversationRoutes from './conversations.ts'
import legacyRoutes from './legacy.ts'
import requestRoutes from './requests.ts'
import runtimeRoutes from './runtime.ts'

const router = express.Router()

router.use(conversationRoutes)
router.use(chatRoutes)
router.use(requestRoutes)
router.use(runtimeRoutes)
router.use(legacyRoutes)

export default router
