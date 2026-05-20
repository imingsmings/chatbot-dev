import express from 'express'
import chatRoutes from './chat.js'
import conversationRoutes from './conversations.js'
import legacyRoutes from './legacy.js'
import requestRoutes from './requests.js'

const router = express.Router()

router.use(conversationRoutes)
router.use(chatRoutes)
router.use(requestRoutes)
router.use(legacyRoutes)

export default router
