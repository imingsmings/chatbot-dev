function createAbortError() {
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

async function readLinesFromStream(stream, onLine, options = {}) {
  const { signal, onAbort } = options
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let abortHandler

  const handleLine = async (line) => {
    throwIfAborted(signal)
    const result = await onLine(line)
    return result === false
  }

  if (signal) {
    abortHandler = () => {
      onAbort?.()
      reader.cancel().catch(() => {})
    }

    if (signal.aborted) {
      await reader.cancel().catch(() => {})
      throw createAbortError()
    }

    signal.addEventListener('abort', abortHandler, { once: true })
  }

  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      throwIfAborted(signal)

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const shouldStop = await handleLine(line)
        if (shouldStop) {
          await reader.cancel()
          return
        }
      }
    }

    buffer += decoder.decode()

    if (buffer.trim()) {
      await handleLine(buffer)
    }
  } catch (err) {
    if (signal?.aborted) {
      throw createAbortError()
    }

    throw err
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler)
    }
  }
}

export {
  readLinesFromStream
}
