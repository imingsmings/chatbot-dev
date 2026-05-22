import express from 'express'
import { askConversation } from '../controllers/chatController.ts'

const router = express.Router()

router.post('/conversations/:id/ask', askConversation)

export default router
