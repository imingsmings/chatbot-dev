// const LLM_ENDPOINT = 'http://localhost:11434/api/generate'
// const LLM_MODEL = 'llama3.2:3b'
const LLM_ENDPOINT = process.env.LLM_ENDPOINT
const LLM_MODEL = process.env.LLM_MODEL
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS)

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
  const response = await fetchWithTimeout(LLM_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: ` Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: prompt,
      stream
    })
  })

  if (!response.ok) {
    throw new Error(`Failed to request model：${response.status} : ${response.statusText}`)
  }

  if (!stream) {
    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')

  let fullResponse = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    const chunk = decoder.decode(value, { stream: true })

    const lines = chunk.split('\n').filter((line) => line.trim())

    for (const line of lines) {
      if (!line) continue
      if (!line.startsWith('data: ')) continue

      const jsonStr = line.slice(6)

      if (jsonStr === '[DONE]') continue

      try {
        const data = JSON.parse(jsonStr)
        const chunk = data.choices?.[0]?.delta?.content
        if (chunk) {
          fullResponse += chunk
          callback(chunk)
        }
      } catch (e) {
        console.error(`Failed to parse json:`, e.message)
      }
    }
  }

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
