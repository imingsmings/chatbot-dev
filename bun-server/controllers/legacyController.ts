import { clearAllConversations, listConversationSummaries } from '../services/conversationService.ts'
import type { RequestHandler } from '../http/types.ts'

const listHistory: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      conversations: await listConversationSummaries()
    })
  } catch (err) {
    next(err)
  }
}

const clearHistory: RequestHandler = async (req, res, next) => {
  try {
    await clearAllConversations()
    res.json({
      message: '对话历史已经清空'
    })
  } catch (err) {
    next(err)
  }
}

export {
  clearHistory,
  listHistory
}
