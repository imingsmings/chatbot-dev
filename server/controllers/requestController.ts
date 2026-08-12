import { cancelRequest, parseRequestId } from '../utils/requestRegistry.ts'
import type { RequestHandler } from 'express'

type CancelRequestParams = {
  requestId: string
}

type CancelRequestBody = {
  reason?: unknown
}

const CANCEL_REASONS = {
  manual: 'explicit_cancel',
  timeout: 'client_timeout',
  transition: 'client_transition',
  unmount: 'client_unmount'
} as const

const cancelActiveRequest: RequestHandler<CancelRequestParams, unknown, CancelRequestBody> = (req, res) => {
  const requestId = parseRequestId(req.params.requestId)

  if (!requestId) {
    res.status(400).json({
      message: 'requestId 不合法'
    })
    return
  }

  const clientReason = typeof req.body?.reason === 'string' ? req.body.reason : 'manual'
  const reason = CANCEL_REASONS[clientReason as keyof typeof CANCEL_REASONS] ?? 'explicit_cancel'

  res.json({
    cancelled: cancelRequest(requestId, reason)
  })
}

export {
  cancelActiveRequest
}
