import { cancelRequest, parseRequestId } from '../utils/requestRegistry.js'

function cancelActiveRequest(req, res) {
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
