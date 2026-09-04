import {
  cancelRequest,
  isRequestActive,
  parseRequestId,
  waitForRequestCompletion
} from '../utils/requestRegistry.ts'
import {
  finalizeConversationRequest,
  findConversationRequest
} from '../utils/conversationStore.ts'
import type { RequestHandler } from 'express'

type CancelRequestParams = {
  requestId: string
}

type CancelRequestBody = {
  reason?: unknown
}

const getRequestResult: RequestHandler<CancelRequestParams> = async (req, res, next) => {
  const requestId = parseRequestId(req.params.requestId)
  if (!requestId) {
    res.status(400).json({ message: 'requestId 不合法' })
    return
  }

  try {
    let found = await findConversationRequest(requestId)
    if (!found) {
      res.status(404).json({ message: '请求不存在' })
      return
    }
    if (found.request.status === 'processing' && isRequestActive(requestId)) {
      await Promise.race([
        waitForRequestCompletion(requestId),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000))
      ])
      found = await findConversationRequest(requestId) ?? found
    }
    if (found.request.status === 'processing' && !isRequestActive(requestId)) {
      const request = await finalizeConversationRequest(found.conversationId, requestId, 'failed')
      if (request) found = { conversationId: found.conversationId, request }
    }
    res.json({
      request: {
        requestId: found.request.requestId,
        conversationId: found.conversationId,
        status: found.request.status,
        createdAt: found.request.createdAt,
        updatedAt: found.request.updatedAt,
        messageStartIndex: found.request.messageStartIndex,
        messageCount: found.request.messageCount
      }
    })
  } catch (error) {
    next(error)
  }
}

const CANCEL_REASONS = {
  manual: 'explicit_cancel',
  timeout: 'client_timeout',
  transition: 'client_transition',
  unmount: 'client_unmount'
} as const

const cancelActiveRequest: RequestHandler<CancelRequestParams, unknown, CancelRequestBody> = async (req, res) => {
  const requestId = parseRequestId(req.params.requestId)

  if (!requestId) {
    res.status(400).json({
      message: 'requestId 不合法'
    })
    return
  }

  const clientReason = typeof req.body?.reason === 'string' ? req.body.reason : 'manual'
  const reason = CANCEL_REASONS[clientReason as keyof typeof CANCEL_REASONS] ?? 'explicit_cancel'

  const cancelled = cancelRequest(requestId, reason)
  if (cancelled) {
    await waitForRequestCompletion(requestId)
  }

  res.json({
    cancelled,
    completed: cancelled
  })
}

export {
  cancelActiveRequest,
  getRequestResult
}
