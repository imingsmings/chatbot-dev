const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,120}$/

type ActiveRequest = {
  conversationId: string
  controller: AbortController
  startedAt: number
  cancel: (reason?: string) => void
  cancellationRequested: boolean
  completion: Promise<void>
  resolveCompletion: () => void
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

  let resolveCompletion!: () => void
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })

  activeRequests.set(requestId, {
    conversationId,
    controller,
    startedAt: Date.now(),
    cancel,
    cancellationRequested: false,
    completion,
    resolveCompletion
  })

  return true
}

function cancelRequest(requestId: string, reason = 'explicit_cancel'): boolean {
  const activeRequest = activeRequests.get(requestId)

  if (!activeRequest) {
    return false
  }

  if (!activeRequest.cancellationRequested) {
    activeRequest.cancellationRequested = true
    activeRequest.cancel(reason)
  }

  return true
}

function isRequestActive(requestId: string): boolean {
  return activeRequests.has(requestId)
}

async function waitForRequestCompletion(requestId: string): Promise<void> {
  await activeRequests.get(requestId)?.completion
}

function cancelAllRequests(reason = 'server_shutdown'): number {
  let cancelledCount = 0
  for (const [requestId, request] of activeRequests) {
    if (!request.cancellationRequested && cancelRequest(requestId, reason)) {
      cancelledCount += 1
    }
  }
  return cancelledCount
}

function completeRequest(requestId: string, controller: AbortController): void {
  const activeRequest = activeRequests.get(requestId)

  if (activeRequest?.controller === controller) {
    activeRequests.delete(requestId)
    activeRequest.resolveCompletion()
  }
}

export {
  cancelAllRequests,
  cancelRequest,
  completeRequest,
  isRequestActive,
  parseRequestId,
  registerRequest,
  waitForRequestCompletion
}
