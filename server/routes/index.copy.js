const express = require('express')
const router = express.Router()

const MODEL = 'llama3.2:3b'

const conversations = []

router.post('/ask', async (req, res) => {
  const question = req.body.question || ''

  // const prompt = `
  //   你是一个中文智能助手，请使用中文回答用户的问题。
  //   问题：${question}
  // `
  const prompt = [
    `你是一个中文智能助手，请使用中文回答用户的问题。`,
    ...conversations.map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`),
    ` 问题：${question}`
  ].join('\n')

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: true
    })
  })

  // const result = await response.json()
  // res.json({
  //   answer: result.response
  // })

  // res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let fullResponse = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const text = line.trim()
      if (!text) continue

      try {
        const data = JSON.parse(text)
        if (data.response) {
          fullResponse += data.response
          res.write(`${JSON.stringify({ response: data.response })}\n`)
        }
      } catch (e) {
        console.error(`Failed to parse json:`, e.message)
      }
    }
  }

  buffer += decoder.decode()

  if (buffer.trim()) {
    try {
      const data = JSON.parse(buffer)

      if (data.response) {
        fullResponse += data.response
        res.write(`${JSON.stringify({ response: data.response })}\n`)
      }
    } catch (e) {
      console.error('Failed to parse json:', e.message)
    }
  }

  conversations.push({ role: 'user', content: question }, { role: 'assistant', content: fullResponse })

  if (conversations.length > 20) {
    conversations.splice(0, conversations.length - 20)
  }

  res.end()
})

router.get('/history', function (req, res) {
  res.json({
    conversations
  })
})

router.post('/clear', function (req, res) {
  conversations.length = 0
  res.json({
    message: '对话历史已经清空'
  })
})

module.exports = router
