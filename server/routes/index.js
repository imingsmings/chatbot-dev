const express = require('express')
const router = express.Router()
const { buildFunctionCallPrompt, buildStandardPrompt, buildAnswerPrompt } = require('../utils/promptTemplates')
const { callLLM, callLLMStream } = require('../utils/llm')
const { getWeather } = require('../utils/weatherHandler')
const {
  appendMessages,
  clearConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation
} = require('../utils/conversationStore')

const toolsMap = {
  getWeather
}

function writeStreamEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`)
}

function writeStreamError(res, err) {
  const message = err instanceof Error ? err.message : '模型响应失败'
  writeStreamEvent(res, {
    type: 'error',
    message
  })
}

function writeNotFound(res) {
  res.status(404).json({
    message: '会话不存在'
  })
}

router.get('/conversations', async (req, res, next) => {
  try {
    res.json({
      conversations: await listConversations()
    })
  } catch (err) {
    next(err)
  }
})

router.post('/conversations', async (req, res, next) => {
  try {
    const conversation = await createConversation(req.body.title)
    res.status(201).json({
      conversation
    })
  } catch (err) {
    next(err)
  }
})

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conversation = await getConversation(req.params.id)

    if (!conversation) {
      writeNotFound(res)
      return
    }

    res.json({
      conversation
    })
  } catch (err) {
    next(err)
  }
})

router.patch('/conversations/:id', async (req, res, next) => {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : ''

    if (!title) {
      res.status(400).json({
        message: '会话名称不能为空'
      })
      return
    }

    const conversation = await renameConversation(req.params.id, title)

    if (!conversation) {
      writeNotFound(res)
      return
    }

    res.json({
      conversation
    })
  } catch (err) {
    next(err)
  }
})

router.delete('/conversations/:id', async (req, res, next) => {
  try {
    const deleted = await deleteConversation(req.params.id)

    if (!deleted) {
      writeNotFound(res)
      return
    }

    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

router.post('/conversations/:id/clear', async (req, res, next) => {
  try {
    const conversation = await clearConversation(req.params.id)

    if (!conversation) {
      writeNotFound(res)
      return
    }

    res.json({
      conversation
    })
  } catch (err) {
    next(err)
  }
})

router.post('/conversations/:id/ask', async (req, res, next) => {
  const question = req.body.question || ''
  let conversation

  try {
    conversation = await getConversation(req.params.id)
  } catch (err) {
    next(err)
    return
  }

  if (!conversation) {
    writeNotFound(res)
    return
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  try {
    let finalResponse = ''
    const functionCallPrompt = buildFunctionCallPrompt(question)
    const functionCallResult = await callLLM(functionCallPrompt)

    if (functionCallResult.trim() === '无函数调用') {
      const prompt = buildStandardPrompt(question, conversation.messages)
      finalResponse = await callLLMStream(prompt, (chunk) => {
        writeStreamEvent(res, { type: 'delta', content: chunk })
      })
    } else {
      const toolCalls = JSON.parse(functionCallResult)
      const toolResults = []

      for (const tool of toolCalls) {
        const functionName = tool.function
        const args = tool.args

        if (toolsMap[functionName]) {
          try {
            const result = await toolsMap[functionName](args)
            toolResults.push({
              function: functionName,
              args,
              result: result
            })
          } catch (err) {
            console.error(`Failed to call tool ${functionName}`, err)
            toolResults.push({
              function: functionName,
              args,
              result: `Failed to call tool ${err.message}`
            })
          }
        } else {
          console.error(`${functionName} tool do not exist`)
          toolResults.push({
            function: functionName,
            args,
            result: `unknown tool`
          })
        }
      }

      const answerPrompt = buildAnswerPrompt(question, toolResults)
      finalResponse = await callLLMStream(answerPrompt, (chunk) => {
        writeStreamEvent(res, { type: 'delta', content: chunk })
      })
    }

    if (!finalResponse.trim()) {
      throw new Error('模型未返回内容')
    }

    await appendMessages(req.params.id, [
      { role: 'user', content: question },
      { role: 'assistant', content: finalResponse }
    ])

    writeStreamEvent(res, { type: 'done' })
  } catch (err) {
    console.error(`Failed to handle ask request:`, err)
    writeStreamError(res, err)
  }

  res.end()
})

router.get('/history', async function (req, res, next) {
  try {
    const conversations = await listConversations()
    res.json({
      conversations
    })
  } catch (err) {
    next(err)
  }
})

router.post('/clear', async function (req, res, next) {
  try {
    const conversations = await listConversations()
    await Promise.all(conversations.map((conversation) => clearConversation(conversation.id)))
    res.json({
      message: '对话历史已经清空'
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
