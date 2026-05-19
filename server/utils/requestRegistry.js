const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,120}$/
const activeRequests = new Map()

function parseRequestId(value) {
  if (typeof value !== 'string') {
    return null
  }

  const requestId = value.trim()
  return REQUEST_ID_PATTERN.test(requestId) ? requestId : null
}

function registerRequest({ requestId, conversationId, controller, cancel }) {
  if (activeRequests.has(requestId)) {
    return false
  }

  activeRequests.set(requestId, {
    conversationId,
    controller,
    startedAt: Date.now(),
    cancel
  })

  return true
}

function cancelRequest(requestId, reason = 'explicit_cancel') {
  const activeRequest = activeRequests.get(requestId)

  if (!activeRequest) {
    return false
  }

  activeRequest.cancel(reason)
  activeRequests.delete(requestId)

  return true
}

function completeRequest(requestId, controller) {
  const activeRequest = activeRequests.get(requestId)

  if (activeRequest?.controller === controller) {
    activeRequests.delete(requestId)
  }
}

module.exports = {
  cancelRequest,
  completeRequest,
  parseRequestId,
  registerRequest
}
