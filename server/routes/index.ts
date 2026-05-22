import express from 'express'
import chatRoutes from './chat.ts'
import conversationRoutes from './conversations.ts'
import legacyRoutes from './legacy.ts'
import requestRoutes from './requests.ts'

const router = express.Router()

router.use(conversationRoutes)
router.use(chatRoutes)
router.use(requestRoutes)
router.use(legacyRoutes)

export default router
