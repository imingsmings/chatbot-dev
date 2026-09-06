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
  updateConversationModelOptions,
} from '../controllers/conversationController.ts'
import {
  deleteConversationAttachmentHandler,
  readConversationAttachment,
  uploadConversationAttachment,
} from '../controllers/attachmentController.ts'
import { defineRoute } from '../http/router.ts'

const conversationRoutes = [
  defineRoute('GET', '/conversations', listConversations),
  defineRoute('POST', '/conversations', createConversation, 'json'),
  defineRoute('GET', '/conversations/search', searchConversations),
  defineRoute('GET', '/conversations/export.json', exportAllConversations),
  defineRoute('GET', '/conversations/export.zip', exportAllConversationsZip),
  defineRoute('POST', '/conversations/import', importConversations, 'json'),
  defineRoute('POST', '/conversations/import.zip', importConversationsZip, 'raw-zip'),
  defineRoute('POST', '/conversations/:id/branches', branchConversation, 'json'),
  defineRoute('POST', '/conversations/:id/attachments', uploadConversationAttachment, 'multipart'),
  defineRoute('GET', '/conversations/:id/attachments/:attachmentId', readConversationAttachment),
  defineRoute('DELETE', '/conversations/:id/attachments/:attachmentId', deleteConversationAttachmentHandler),
  defineRoute('POST', '/conversations/:id/context-preview', previewConversationContext, 'json'),
  defineRoute('POST', '/conversations/:id/summary', summarizeConversation, 'json'),
  defineRoute('GET', '/conversations/:id/export.md', exportConversationMarkdown),
  defineRoute('GET', '/conversations/:id', getConversation),
  defineRoute('PATCH', '/conversations/:id/model-options', updateConversationModelOptions, 'json'),
  defineRoute('PATCH', '/conversations/:id', renameConversation, 'json'),
  defineRoute('DELETE', '/conversations/:id', deleteConversation),
  defineRoute('POST', '/conversations/:id/clear', clearConversation, 'json'),
]

export { conversationRoutes }
