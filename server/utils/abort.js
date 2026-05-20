function createAbortError(message = '请求已取消') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

export {
  createAbortError,
  throwIfAborted
}
