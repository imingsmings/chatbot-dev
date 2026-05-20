import express from 'express'
import { askConversation } from '../controllers/chatController.js'

const router = express.Router()

router.post('/conversations/:id/ask', askConversation)

export default router
