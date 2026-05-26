import express from 'express'
import {
  clearConversation,
  createConversation,
  deleteConversation,
  exportAllConversations,
  exportConversationMarkdown,
  getConversation,
  listConversations,
  previewConversationContext,
  renameConversation,
  searchConversations
} from '../controllers/conversationController.ts'

const router = express.Router()

router.get('/conversations', listConversations)
router.post('/conversations', createConversation)
router.get('/conversations/search', searchConversations)
router.get('/conversations/export.json', exportAllConversations)
router.post('/conversations/:id/context-preview', previewConversationContext)
router.get('/conversations/:id/export.md', exportConversationMarkdown)
router.get('/conversations/:id', getConversation)
router.patch('/conversations/:id', renameConversation)
router.delete('/conversations/:id', deleteConversation)
router.post('/conversations/:id/clear', clearConversation)

export default router
