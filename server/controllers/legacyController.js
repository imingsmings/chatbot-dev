import { clearAllConversations, listConversationSummaries } from '../services/conversationService.js'

async function listHistory(req, res, next) {
  try {
    res.json({
      conversations: await listConversationSummaries()
    })
  } catch (err) {
    next(err)
  }
}

async function clearHistory(req, res, next) {
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
