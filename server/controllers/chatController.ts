import { generateConversationAnswer } from '../services/chatService.ts'
import { findConversation } from '../services/conversationService.ts'
import { createAbortError } from '../utils/abort.ts'
import { setNdjsonStreamHeaders, writeStreamError, writeStreamEvent } from '../utils/ndjsonStream.ts'
import {
  completeRequest,
  parseRequestId,
  registerRequest
} from '../utils/requestRegistry.ts'
import { parseModelRequestOptions, resolveModelOptions } from '../utils/modelOptions.ts'
import { MAX_IMAGE_ATTACHMENTS_PER_MESSAGE, MAX_QUESTION_LENGTH } from '../config/productLimits.ts'
import { findModelDescriptor } from '../utils/llm/modelCatalog.ts'
import {
  AttachmentError,
  resolveConversationAttachments,
} from '../services/attachmentService.ts'
import type { LlmStreamChunkType } from '../types/llm.ts'
import type { ImageAttachment } from '../types/conversation.ts'
import type { ToolExecutionEvent } from '../types/tools.ts'
import type { RequestHandler, Response } from 'express'

type AskConversationParams = {
  id: string
}

type AskConversationBody = {
  question?: unknown
  requestId?: unknown
  options?: unknown
  attachmentIds?: unknown
}

function writeNotFound(res: Response): void {
  res.status(404).json({
    message: '会话不存在'
  })
}

const askConversation: RequestHandler<AskConversationParams, unknown, AskConversationBody> = async (
  req,
  res,
  next
) => {
  const question = typeof req.body.question === 'string' ? req.body.question.trim() : ''
  const requestId = parseRequestId(req.body.requestId)
  let modelOptions
  let conversation
  let attachments: ImageAttachment[] = []
  const requestController = new AbortController()
  let abortReason: string | null = null

  if (!requestId) {
    res.status(400).json({
      message: 'requestId 不合法'
    })
    return
  }

  if (
    req.body.attachmentIds !== undefined &&
    (!Array.isArray(req.body.attachmentIds) ||
      req.body.attachmentIds.length > MAX_IMAGE_ATTACHMENTS_PER_MESSAGE ||
      req.body.attachmentIds.some((id) => typeof id !== 'string'))
  ) {
    res.status(400).json({
      message: `attachmentIds 必须是最多 ${MAX_IMAGE_ATTACHMENTS_PER_MESSAGE} 个字符串组成的数组`
    })
    return
  }
  const attachmentIds = (req.body.attachmentIds ?? []) as string[]

  if (!question && attachmentIds.length === 0) {
    res.status(400).json({
      message: '问题和图片不能同时为空'
    })
    return
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    res.status(400).json({
      message: `问题不能超过 ${MAX_QUESTION_LENGTH} 个字符`
    })
    return
  }

  try {
    modelOptions = parseModelRequestOptions(req.body.options)
  } catch (err) {
    res.status(400).json({
      message: err instanceof Error ? err.message : '模型参数不合法'
    })
    return
  }

  try {
    conversation = await findConversation(req.params.id)
  } catch (err) {
    next(err)
    return
  }

  if (!conversation) {
    writeNotFound(res)
    return
  }

  try {
    attachments = await resolveConversationAttachments(req.params.id, attachmentIds)
    if (attachments.length) {
      const effectiveOptions = resolveModelOptions(modelOptions)
      const descriptor = findModelDescriptor(effectiveOptions.model)
      if (!descriptor?.capabilities.inputModalities.includes('image')) {
        res.status(400).json({
          message: `${descriptor?.label ?? effectiveOptions.model} 不支持图片，请切换到 Vision 模型`
        })
        return
      }
    }
  } catch (error) {
    if (error instanceof AttachmentError) {
      res.status(error.status).json({ message: error.message })
      return
    }
    next(error)
    return
  }

  const abortUpstream = (reason = 'client_closed'): void => {
    if (requestController.signal.aborted) {
      return
    }

    abortReason = reason
    requestController.abort(reason)
  }

  const abortOnClientClose = (): void => {
    if (res.writableEnded) {
      return
    }

    abortUpstream('client_closed')
  }

  const registered = registerRequest({
    requestId,
    conversationId: req.params.id,
    controller: requestController,
    cancel: abortUpstream
  })

  if (!registered) {
    res.status(409).json({
      message: 'requestId 或会话正在处理中'
    })
    return
  }

  setNdjsonStreamHeaders(res)

  req.on('aborted', abortOnClientClose)
  res.on('close', abortOnClientClose)

  try {
    const writeDelta = (chunk: string, type: LlmStreamChunkType): void => {
      const eventType = type === 'reasoning' ? 'reasoning_delta' : 'delta'

      if (!writeStreamEvent(res, { type: eventType, content: chunk })) {
        abortUpstream('write_closed')
        throw createAbortError()
      }
    }
    const writeToolEvent = (event: ToolExecutionEvent): void => {
      const streamEvent = event.type === 'tool_start'
        ? {
            type: 'tool_start' as const,
            toolCallId: event.toolCallId,
            name: event.name
          }
        : {
            type: 'tool_result' as const,
            toolCallId: event.toolCallId,
            name: event.name,
            summary: event.summary,
            success: event.success
          }

      if (!writeStreamEvent(res, streamEvent)) {
        abortUpstream('write_closed')
        throw createAbortError()
      }
    }

    const answer = await generateConversationAnswer({
      conversation,
      conversationId: req.params.id,
      question,
      attachments,
      signal: requestController.signal,
      onDelta: writeDelta,
      onToolEvent: writeToolEvent,
      modelOptions
    })

    writeStreamEvent(res, { type: 'done', reasoningDurationMs: answer.reasoningDurationMs })
  } catch (err: unknown) {
    if (abortReason || (err instanceof Error && err.name === 'AbortError')) {
      console.info(
        `Ask request aborted: conversation=${req.params.id}, request=${requestId}, reason=${abortReason || 'abort_error'}`
      )
      return
    }

    console.error(`Failed to handle ask request:`, err)
    writeStreamError(res, err)
  } finally {
    req.off('aborted', abortOnClientClose)
    res.off('close', abortOnClientClose)
    completeRequest(requestId, requestController)

    if (!res.destroyed && !res.writableEnded) {
      res.end()
    }
  }
}

export {
  askConversation
}
