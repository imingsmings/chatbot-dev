import {
  clearConversationMessages,
  createNewConversation,
  findConversation,
  listConversationSummaries,
  removeConversation,
  updateConversationTitle
} from '../services/conversationService.ts'
import type { RequestHandler, Response } from 'express'

type ConversationParams = {
  id: string
}

type CreateConversationBody = {
  title?: unknown
}

type RenameConversationBody = {
  title?: unknown
}

function writeNotFound(res: Response): void {
  res.status(404).json({
    message: '会话不存在'
  })
}

const listConversations: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      conversations: await listConversationSummaries()
    })
  } catch (err) {
    next(err)
  }
}

const createConversation: RequestHandler<unknown, unknown, CreateConversationBody> = async (req, res, next) => {
  try {
    const conversation = await createNewConversation(req.body.title)
    res.status(201).json({
      conversation
    })
  } catch (err) {
    next(err)
  }
}

const getConversation: RequestHandler<ConversationParams> = async (req, res, next) => {
  try {
    const conversation = await findConversation(req.params.id)

    if (!conversation) {
      writeNotFound(res)
      return
    }

    res.json({
      conversation
    })
  } catch (err) {
    next(err)
  }
}

const renameConversation: RequestHandler<ConversationParams, unknown, RenameConversationBody> = async (
  req,
  res,
  next
) => {
  try {
    const result = await updateConversationTitle(req.params.id, req.body.title)

    if (result.error === 'empty_title') {
      res.status(400).json({
        message: '会话名称不能为空'
      })
      return
    }

    if (!result.conversation) {
      writeNotFound(res)
      return
    }

    res.json({
      conversation: result.conversation
    })
  } catch (err) {
    next(err)
  }
}

const deleteConversation: RequestHandler<ConversationParams> = async (req, res, next) => {
  try {
    const deleted = await removeConversation(req.params.id)

    if (!deleted) {
      writeNotFound(res)
      return
    }

    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

const clearConversation: RequestHandler<ConversationParams> = async (req, res, next) => {
  try {
    const conversation = await clearConversationMessages(req.params.id)

    if (!conversation) {
      writeNotFound(res)
      return
    }

    res.json({
      conversation
    })
  } catch (err) {
    next(err)
  }
}

export {
  clearConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation
}
