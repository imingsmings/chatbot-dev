import { cancelRequest, parseRequestId } from '../utils/requestRegistry.ts'
import type { RequestHandler } from 'express'

type CancelRequestParams = {
  requestId: string
}

const cancelActiveRequest: RequestHandler<CancelRequestParams> = (req, res) => {
  const requestId = parseRequestId(req.params.requestId)

  if (!requestId) {
    res.status(400).json({
      message: 'requestId 不合法'
    })
    return
  }

  res.json({
    cancelled: cancelRequest(requestId, 'explicit_cancel')
  })
}

export {
  cancelActiveRequest
}
