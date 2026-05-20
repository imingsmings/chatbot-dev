import express from 'express'
import {
  clearConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation
} from '../controllers/conversationController.js'

const router = express.Router()

router.get('/conversations', listConversations)
router.post('/conversations', createConversation)
router.get('/conversations/:id', getConversation)
router.patch('/conversations/:id', renameConversation)
router.delete('/conversations/:id', deleteConversation)
router.post('/conversations/:id/clear', clearConversation)

export default router
