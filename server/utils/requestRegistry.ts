const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,120}$/

type ActiveRequest = {
  conversationId: string
  controller: AbortController
  startedAt: number
  cancel: (reason?: string) => void
}

const activeRequests = new Map<string, ActiveRequest>()

function parseRequestId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const requestId = value.trim()
  return REQUEST_ID_PATTERN.test(requestId) ? requestId : null
}

function registerRequest({
  requestId,
  conversationId,
  controller,
  cancel
}: {
  requestId: string
  conversationId: string
  controller: AbortController
  cancel: (reason?: string) => void
}): boolean {
  if (
    activeRequests.has(requestId) ||
    [...activeRequests.values()].some((request) => request.conversationId === conversationId)
  ) {
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

function cancelRequest(requestId: string, reason = 'explicit_cancel'): boolean {
  const activeRequest = activeRequests.get(requestId)

  if (!activeRequest) {
    return false
  }

  activeRequest.cancel(reason)
  activeRequests.delete(requestId)

  return true
}

function completeRequest(requestId: string, controller: AbortController): void {
  const activeRequest = activeRequests.get(requestId)

  if (activeRequest?.controller === controller) {
    activeRequests.delete(requestId)
  }
}

export {
  cancelRequest,
  completeRequest,
  parseRequestId,
  registerRequest
}
