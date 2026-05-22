import { createAbortError, throwIfAborted } from './abort.ts'

type ReadLinesOptions = {
  signal?: AbortSignal
  onAbort?: () => void
}

async function readLinesFromStream(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => boolean | void | Promise<boolean | void>,
  options: ReadLinesOptions = {}
): Promise<void> {
  const { signal, onAbort } = options
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let abortHandler: (() => void) | undefined

  const handleLine = async (line: string): Promise<boolean> => {
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
  } catch (err: unknown) {
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
