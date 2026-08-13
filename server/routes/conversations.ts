import express from 'express'
import {
  branchConversation,
  clearConversation,
  createConversation,
  deleteConversation,
  exportAllConversations,
  exportConversationMarkdown,
  getConversation,
  importConversations,
  listConversations,
  previewConversationContext,
  renameConversation,
  searchConversations,
  summarizeConversation,
  updateConversationModelOptions
} from '../controllers/conversationController.ts'

const router = express.Router()

router.get('/conversations', listConversations)
router.post('/conversations', createConversation)
router.get('/conversations/search', searchConversations)
router.get('/conversations/export.json', exportAllConversations)
router.post('/conversations/import', importConversations)
router.post('/conversations/:id/branches', branchConversation)
router.post('/conversations/:id/context-preview', previewConversationContext)
router.post('/conversations/:id/summary', summarizeConversation)
router.get('/conversations/:id/export.md', exportConversationMarkdown)
router.get('/conversations/:id', getConversation)
router.patch('/conversations/:id/model-options', updateConversationModelOptions)
router.patch('/conversations/:id', renameConversation)
router.delete('/conversations/:id', deleteConversation)
router.post('/conversations/:id/clear', clearConversation)

export default router
