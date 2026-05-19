function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
  }
}

function buildBody({ model, prompt, stream }) {
  return {
    model,
    messages: prompt,
    stream
  }
}

function parseResponse(data) {
  return data.choices?.[0]?.message?.content || ''
}

function parseStreamLine(line) {
  const text = line.trim()
  if (!text) return null
  if (!text.startsWith('data: ')) return null

  const jsonStr = text.slice(6)
  if (jsonStr === '[DONE]') {
    return { done: true }
  }

  const data = JSON.parse(jsonStr)
  const content = data.choices?.[0]?.delta?.content

  return content ? { content } : null
}

export default {
  name: 'deepseek',
  buildHeaders,
  buildBody,
  parseResponse,
  parseStreamLine
}
