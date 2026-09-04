import express from 'express'
import { MAX_PORTABLE_BACKUP_BYTES } from '../config/productLimits.ts'
import {
  branchConversation,
  clearConversation,
  createConversation,
  deleteConversation,
  exportAllConversations,
  exportAllConversationsZip,
  exportConversationMarkdown,
  getConversation,
  importConversations,
  importConversationsZip,
  listConversations,
  previewConversationContext,
  renameConversation,
  searchConversations,
  summarizeConversation,
  updateConversationModelOptions
} from '../controllers/conversationController.ts'
import {
  deleteConversationAttachmentHandler,
  readConversationAttachment,
  uploadConversationAttachment,
} from '../controllers/attachmentController.ts'

const router = express.Router()

router.get('/conversations', listConversations)
router.post('/conversations', createConversation)
router.get('/conversations/search', searchConversations)
router.get('/conversations/export.json', exportAllConversations)
router.get('/conversations/export.zip', exportAllConversationsZip)
router.post('/conversations/import', importConversations)
router.post(
  '/conversations/import.zip',
  express.raw({
    type: ['application/zip', 'application/octet-stream'],
    limit: MAX_PORTABLE_BACKUP_BYTES,
  }),
  importConversationsZip,
)
router.post('/conversations/:id/branches', branchConversation)
router.post('/conversations/:id/attachments', uploadConversationAttachment)
router.get('/conversations/:id/attachments/:attachmentId', readConversationAttachment)
router.delete('/conversations/:id/attachments/:attachmentId', deleteConversationAttachmentHandler)
router.post('/conversations/:id/context-preview', previewConversationContext)
router.post('/conversations/:id/summary', summarizeConversation)
router.get('/conversations/:id/export.md', exportConversationMarkdown)
router.get('/conversations/:id', getConversation)
router.patch('/conversations/:id/model-options', updateConversationModelOptions)
router.patch('/conversations/:id', renameConversation)
router.delete('/conversations/:id', deleteConversation)
router.post('/conversations/:id/clear', clearConversation)

export default router
