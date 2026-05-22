import { generateConversationAnswer } from '../services/chatService.ts'
import { findConversation } from '../services/conversationService.ts'
import { createAbortError } from '../utils/abort.ts'
import { setNdjsonStreamHeaders, writeStreamError, writeStreamEvent } from '../utils/ndjsonStream.ts'
import {
  completeRequest,
  parseRequestId,
  registerRequest
} from '../utils/requestRegistry.ts'
import type { RequestHandler, Response } from 'express'

type AskConversationParams = {
  id: string
}

type AskConversationBody = {
  question?: unknown
  requestId?: unknown
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
  let conversation
  const requestController = new AbortController()
  let abortReason: string | null = null

  if (!requestId) {
    res.status(400).json({
      message: 'requestId 不合法'
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
    const writeDelta = (chunk: string): void => {
      if (!writeStreamEvent(res, { type: 'delta', content: chunk })) {
        abortUpstream('write_closed')
        throw createAbortError()
      }
    }

    await generateConversationAnswer({
      conversation,
      conversationId: req.params.id,
      question,
      signal: requestController.signal,
      onDelta: writeDelta
    })

    writeStreamEvent(res, { type: 'done' })
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
