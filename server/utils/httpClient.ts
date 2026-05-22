import { createAbortError } from './abort.ts'

const configuredTimeout = Number(process.env.LLM_TIMEOUT_MS)
const DEFAULT_TIMEOUT_MS =
  Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 30000

type FetchWithTimeoutResult = {
  response: Response
  signal: AbortSignal
  abortUpstream: () => void
  cleanup: () => void
}

async function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeout = DEFAULT_TIMEOUT_MS,
  externalSignal?: AbortSignal
): Promise<FetchWithTimeoutResult> {
  const controller = new AbortController()
  let timeoutTriggered = false
  let abortHandler: (() => void) | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  if (externalSignal?.aborted) {
    throw createAbortError()
  }

  const abortUpstream = () => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  }

  if (externalSignal) {
    abortHandler = abortUpstream
    externalSignal.addEventListener('abort', abortHandler, { once: true })
  }

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }

    if (externalSignal && abortHandler) {
      externalSignal.removeEventListener('abort', abortHandler)
      abortHandler = undefined
    }
  }

  timeoutId = setTimeout(() => {
    timeoutTriggered = true
    abortUpstream()
  }, timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    timeoutId = undefined

    return {
      response,
      signal: controller.signal,
      abortUpstream,
      cleanup
    }
  } catch (err: unknown) {
    cleanup()

    if (err instanceof Error && err.name === 'AbortError') {
      if (timeoutTriggered) {
        throw new Error('请求超时，请稍候重试')
      }

      throw createAbortError()
    }

    throw err
  }
}

export {
  DEFAULT_TIMEOUT_MS,
  fetchWithTimeout
}
