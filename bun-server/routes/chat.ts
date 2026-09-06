import { askConversation } from '../controllers/chatController.ts'
import { defineRoute } from '../http/router.ts'

const chatRoutes = [
  defineRoute('POST', '/conversations/:id/ask', askConversation, 'json'),
]

export { chatRoutes }
