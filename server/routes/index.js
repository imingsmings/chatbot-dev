import express from 'express'
import { buildAnswerPrompt, buildFunctionCallPrompt, buildStandardPrompt } from '../utils/promptTemplates.js'
import { callLLM, callLLMStream } from '../utils/llm.js'
import { getWeather } from '../utils/weatherHandler.js'
import {
  appendMessages,
  clearConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation
} from '../utils/conversationStore.js'
import {
  cancelRequest,
  completeRequest,
  parseRequestId,
  registerRequest
} from '../utils/requestRegistry.js'

const router = express.Router()

const toolsMap = {
  getWeather
}

function writeStreamEvent(res, event) {
  if (res.destroyed || res.writableEnded) {
    return false
  }

  res.write(`${JSON.stringify(event)}\n`)
  return true
}

function writeStreamError(res, err) {
  const message = err instanceof Error ? err.message : '模型响应失败'
  writeStreamEvent(res, {
    type: 'error',
    message
  })
}

function createAbortError(message = '请求已取消') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal.aborted) {
    throw createAbortError()
  }
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

router.post('/requests/:requestId/cancel', (req, res) => {
  const requestId = parseRequestId(req.params.requestId)

  if (!requestId) {
    res.status(400).json({
      message: 'requestId 不合法'
    })
    return
  }

  res.json({
    cancelled: cancelRequest(requestId, 'explicit_cancel')
  })
})

router.post('/conversations/:id/ask', async (req, res, next) => {
  const question = req.body.question || ''
  const requestId = parseRequestId(req.body.requestId)
  let conversation
  const requestController = new AbortController()
  let abortReason = null

  if (!requestId) {
    res.status(400).json({
      message: 'requestId 不合法'
    })
    return
  }

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

  const abortUpstream = (reason = 'client_closed') => {
    if (requestController.signal.aborted) {
      return
    }

    abortReason = reason
    requestController.abort()
  }

  const abortOnClientClose = () => {
    if (res.writableEnded) {
      return
    }

    abortUpstream('client_closed')
  }

  const registered = registerRequest({
    requestId,
    conversationId: req.params.id,
    controller: requestController,
    cancel: abortUpstream
  })

  if (!registered) {
    res.status(409).json({
      message: 'requestId 正在处理中'
    })
    return
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  req.on('aborted', abortOnClientClose)
  res.on('close', abortOnClientClose)

  try {
    let finalResponse = ''
    const writeDelta = (chunk) => {
      if (!writeStreamEvent(res, { type: 'delta', content: chunk })) {
        abortUpstream('write_closed')
        throw createAbortError()
      }
    }

    const functionCallPrompt = buildFunctionCallPrompt(question)
    const functionCallResult = await callLLM(functionCallPrompt, {
      signal: requestController.signal
    })
    throwIfAborted(requestController.signal)

    if (functionCallResult.trim() === '无函数调用') {
      const prompt = buildStandardPrompt(question, conversation.messages)
      finalResponse = await callLLMStream(prompt, writeDelta, {
        signal: requestController.signal
      })
    } else {
      const toolCalls = JSON.parse(functionCallResult)
      const toolResults = []

      for (const tool of toolCalls) {
        throwIfAborted(requestController.signal)

        const functionName = tool.function
        const args = tool.args

        if (toolsMap[functionName]) {
          try {
            const result = await toolsMap[functionName](args, {
              signal: requestController.signal
            })
            throwIfAborted(requestController.signal)
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

      throwIfAborted(requestController.signal)
      const answerPrompt = buildAnswerPrompt(question, toolResults)
      finalResponse = await callLLMStream(answerPrompt, writeDelta, {
        signal: requestController.signal
      })
    }

    throwIfAborted(requestController.signal)

    if (!finalResponse.trim()) {
      throw new Error('模型未返回内容')
    }

    await appendMessages(req.params.id, [
      { role: 'user', content: question },
      { role: 'assistant', content: finalResponse }
    ])

    writeStreamEvent(res, { type: 'done' })
  } catch (err) {
    if (abortReason || err?.name === 'AbortError') {
      console.info(`Ask request aborted: conversation=${req.params.id}, request=${requestId}, reason=${abortReason || 'abort_error'}`)
      return
    }

    console.error(`Failed to handle ask request:`, err)
    writeStreamError(res, err)
  } finally {
    req.off('aborted', abortOnClientClose)
    res.off('close', abortOnClientClose)
    completeRequest(requestId, requestController)

    if (!res.destroyed && !res.writableEnded) {
      res.end()
    }
  }
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

export default router
