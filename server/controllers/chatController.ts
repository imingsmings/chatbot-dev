import { generateConversationAnswer } from '../services/chatService.ts'
import { findConversation } from '../services/conversationService.ts'
import { createAbortError } from '../utils/abort.ts'
import { setNdjsonStreamHeaders, writeStreamError, writeStreamEvent } from '../utils/ndjsonStream.ts'
import {
  completeRequest,
  parseRequestId,
  registerRequest
} from '../utils/requestRegistry.ts'
import { parseModelRequestOptions } from '../utils/modelOptions.ts'
import type { LlmStreamChunkType } from '../types/llm.ts'
import type { ToolExecutionEvent } from '../types/tools.ts'
import type { RequestHandler, Response } from 'express'

type AskConversationParams = {
  id: string
}

type AskConversationBody = {
  question?: unknown
  requestId?: unknown
  options?: unknown
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
  const question = typeof req.body.question === 'string' ? req.body.question : ''
  const requestId = parseRequestId(req.body.requestId)
  let modelOptions
  let conversation
  const requestController = new AbortController()
  let abortReason: string | null = null

  if (!requestId) {
    res.status(400).json({
      message: 'requestId 不合法'
    })
    return
  }

  if (!question.trim()) {
    res.status(400).json({
      message: '问题不能为空'
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

  const abortUpstream = (reason = 'client_closed'): void => {
    if (requestController.signal.aborted) {
      return
    }

    abortReason = reason
    requestController.abort()
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
      message: 'requestId 正在处理中'
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
