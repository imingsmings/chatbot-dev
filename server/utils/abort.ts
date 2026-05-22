function createAbortError(message = '请求已取消'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

export {
  createAbortError,
  throwIfAborted
}
