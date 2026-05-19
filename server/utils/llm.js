const { readLinesFromStream } = require('./streamReader')
const deepseekAdapter = require('./llmAdapters/deepseek')

const adapters = {
  deepseek: deepseekAdapter
}

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'deepseek'
const LLM_ENDPOINT = process.env.LLM_ENDPOINT
const LLM_MODEL = process.env.LLM_MODEL
const configuredTimeout = Number(process.env.LLM_TIMEOUT_MS)
const LLM_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 30000

function createAbortError(message = '请求已取消') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function getAdapter() {
  const adapter = adapters[LLM_PROVIDER]

  if (!adapter) {
    throw new Error(`Unsupported LLM provider: ${LLM_PROVIDER}`)
  }

  return adapter
}

async function fetchWithTimeout(url, options = {}, timeout = LLM_TIMEOUT_MS, externalSignal) {
  const controller = new AbortController()
  let timeoutTriggered = false
  let abortHandler
  let timeoutId

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
  } catch (err) {
    cleanup()

    if (err?.name === 'AbortError') {
      if (timeoutTriggered) {
        throw new Error('请求超时，请稍候重试')
      }

      throw createAbortError()
    }

    throw err
  }
}

async function readResponseText(response, signal, onAbort) {
  if (!response.body) {
    return response.text()
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let abortHandler

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
      if (signal?.aborted) {
        throw createAbortError()
      }

      const { done, value } = await reader.read()

      if (signal?.aborted) {
        throw createAbortError()
      }

      if (done) {
        break
      }

      text += decoder.decode(value, { stream: true })
    }

    text += decoder.decode()

    return text
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

async function callLLM({ prompt, stream = false, callback, signal }) {
  const adapter = getAdapter()
  const upstream = await fetchWithTimeout(
    LLM_ENDPOINT,
    {
      method: 'POST',
      headers: adapter.buildHeaders(),
      body: JSON.stringify(adapter.buildBody({ model: LLM_MODEL, prompt, stream }))
    },
    LLM_TIMEOUT_MS,
    signal
  )
  const { response } = upstream

  try {
    if (!response.ok) {
      throw new Error(`Failed to request model：${response.status} : ${response.statusText}`)
    }

    if (!stream) {
      const text = await readResponseText(response, upstream.signal, upstream.abortUpstream)
      const data = JSON.parse(text)
      return adapter.parseResponse(data)
    }

    let fullResponse = ''

    const handleStreamLine = (line) => {
      const event = adapter.parseStreamLine(line)
      if (!event) return

      if (event.done) {
        return false
      }

      if (event.content) {
        fullResponse += event.content
        callback(event.content)
      }
    }

    await readLinesFromStream(response.body, handleStreamLine, {
      signal: upstream.signal,
      onAbort: upstream.abortUpstream
    })

    return fullResponse
  } finally {
    upstream.cleanup()
  }
}

module.exports = {
  callLLM: (prompt, options = {}) => {
    return callLLM({
      prompt,
      signal: options.signal
    })
  },

  callLLMStream: (prompt, callback, options = {}) => {
    return callLLM({
      prompt,
      stream: true,
      callback,
      signal: options.signal
    })
  }
}
