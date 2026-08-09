import {
  clearConversationMessages,
  createNewConversation,
  findConversation,
  listConversationSummaries,
  removeConversation,
  searchConversationSummaries,
  updateConversationTitle
} from '../services/conversationService.ts'
import { buildContextPreview } from '../services/contextDebugService.ts'
import {
  exportAllConversationsAsJson,
  exportConversationAsMarkdown
} from '../services/conversationExportService.ts'
import { importConversationBackup } from '../services/conversationImportService.ts'
import { generateConversationSummary } from '../services/conversationSummaryService.ts'
import { parseModelRequestOptions } from '../utils/modelOptions.ts'
import {
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_SEARCH_QUERY_LENGTH,
} from '../config/productLimits.ts'
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

type ContextPreviewBody = {
  question?: unknown
  options?: unknown
}

type ImportConversationBody = {
  backup?: unknown
  conflictStrategy?: unknown
}

type GenerateSummaryBody = {
  options?: unknown
}

type SearchConversationQuery = {
  q?: unknown
}

function writeNotFound(res: Response): void {
  res.status(404).json({
    message: '会话不存在'
  })
}

function setAttachmentHeaders(res: Response, filename: string, contentType: string): void {
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Type', contentType)
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
    if (req.body.title !== undefined && typeof req.body.title !== 'string') {
      res.status(400).json({
        message: '会话名称必须是字符串'
      })
      return
    }
    if (
      typeof req.body.title === 'string' &&
      req.body.title.trim().length > MAX_CONVERSATION_TITLE_LENGTH
    ) {
      res.status(400).json({
        message: `会话名称不能超过 ${MAX_CONVERSATION_TITLE_LENGTH} 个字符`
      })
      return
    }
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

const searchConversations: RequestHandler<unknown, unknown, unknown, SearchConversationQuery> = async (
  req,
  res,
  next
) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''

    if (!query) {
      res.status(400).json({
        message: '搜索关键词不能为空'
      })
      return
    }

    if (query.length > MAX_SEARCH_QUERY_LENGTH) {
      res.status(400).json({
        message: `搜索关键词不能超过 ${MAX_SEARCH_QUERY_LENGTH} 个字符`
      })
      return
    }

    res.json({
      conversations: await searchConversationSummaries(query)
    })
  } catch (err) {
    next(err)
  }
}

const exportAllConversations: RequestHandler = async (req, res, next) => {
  try {
    const exported = await exportAllConversationsAsJson()
    setAttachmentHeaders(res, exported.filename, 'application/json; charset=utf-8')
    res.send(exported.content)
  } catch (err) {
    next(err)
  }
}

const importConversations: RequestHandler<unknown, unknown, ImportConversationBody> = async (
  req,
  res,
  next
) => {
  try {
    const result = await importConversationBackup(req.body.backup, req.body.conflictStrategy)
    res.status(201).json({ result })
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ message: err.message })
      return
    }
    next(err)
  }
}

const exportConversationMarkdown: RequestHandler<ConversationParams> = async (req, res, next) => {
  try {
    const exported = await exportConversationAsMarkdown(req.params.id)

    if (!exported) {
      writeNotFound(res)
      return
    }

    setAttachmentHeaders(res, exported.filename, 'text/markdown; charset=utf-8')
    res.send(exported.content)
  } catch (err) {
    next(err)
  }
}

const previewConversationContext: RequestHandler<ConversationParams, unknown, ContextPreviewBody> = async (
  req,
  res,
  next
) => {
  try {
    const conversation = await findConversation(req.params.id)

    if (!conversation) {
      writeNotFound(res)
      return
    }


    if (typeof req.body.question === 'string' && req.body.question.length > MAX_QUESTION_LENGTH) {
      res.status(400).json({
        message: `问题不能超过 ${MAX_QUESTION_LENGTH} 个字符`
      })
      return
    }

    let options
    try {
      options = parseModelRequestOptions(req.body.options)
    } catch (err) {
      res.status(400).json({
        message: err instanceof Error ? err.message : '模型参数不合法'
      })
      return
    }

    res.json({
      context: buildContextPreview(
        conversation,
        typeof req.body.question === 'string' ? req.body.question : '',
        options
      )
    })
  } catch (err) {
    next(err)
  }
}

const summarizeConversation: RequestHandler<ConversationParams, unknown, GenerateSummaryBody> = async (
  req,
  res,
  next
) => {
  const controller = new AbortController()
  const abortOnClientClose = (): void => {
    if (!res.writableEnded && !controller.signal.aborted) {
      controller.abort()
    }
  }

  let options
  try {
    options = parseModelRequestOptions(req.body.options)
  } catch (err) {
    res.status(400).json({
      message: err instanceof Error ? err.message : '模型参数不合法'
    })
    return
  }

  req.on('aborted', abortOnClientClose)
  res.on('close', abortOnClientClose)

  try {
    const result = await generateConversationSummary(req.params.id, options, controller.signal)

    if (result.error === 'not_found') {
      writeNotFound(res)
      return
    }

    if (result.error === 'empty') {
      res.status(400).json({
        message: '当前会话没有可摘要的消息'
      })
      return
    }

    if (result.error === 'conversation_changed') {
      res.status(409).json({
        message: '会话内容已更新，请重新生成摘要'
      })
      return
    }

    res.json({
      conversation: result.conversation
    })
  } catch (err) {
    if (controller.signal.aborted) {
      return
    }
    next(err)
  } finally {
    req.off('aborted', abortOnClientClose)
    res.off('close', abortOnClientClose)
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

    if (result.error === 'title_too_long') {
      res.status(400).json({
        message: `会话名称不能超过 ${MAX_CONVERSATION_TITLE_LENGTH} 个字符`
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
  exportAllConversations,
  exportConversationMarkdown,
  getConversation,
  importConversations,
  listConversations,
  previewConversationContext,
  renameConversation,
  searchConversations,
  summarizeConversation
}
