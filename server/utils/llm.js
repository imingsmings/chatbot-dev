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

function getAdapter() {
  const adapter = adapters[LLM_PROVIDER]

  if (!adapter) {
    throw new Error(`Unsupported LLM provider: ${LLM_PROVIDER}`)
  }

  return adapter
}

async function fetchWithTimeout(url, options = {}, timeout = LLM_TIMEOUT_MS) {
  const controller = new AbortController()

  const timeoutId = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    return response
  } catch (err) {
    clearTimeout(timeoutId)

    if (err.name === 'AbortError') throw new Error('请求超时，请稍候重试')

    throw err
  }
}

async function callLLM({ prompt, stream = false, callback }) {
  const adapter = getAdapter()
  const response = await fetchWithTimeout(LLM_ENDPOINT, {
    method: 'POST',
    headers: adapter.buildHeaders(),
    body: JSON.stringify(adapter.buildBody({ model: LLM_MODEL, prompt, stream }))
  })

  if (!response.ok) {
    throw new Error(`Failed to request model：${response.status} : ${response.statusText}`)
  }

  if (!stream) {
    const data = await response.json()
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

  await readLinesFromStream(response.body, handleStreamLine)

  return fullResponse
}

module.exports = {
  callLLM: (prompt) => {
    return callLLM({
      prompt
    })
  },

  callLLMStream: (prompt, callback) => {
    return callLLM({
      prompt,
      stream: true,
      callback
    })
  }
}
