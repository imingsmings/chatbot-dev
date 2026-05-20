import { generateConversationAnswer } from '../services/chatService.js'
import { findConversation } from '../services/conversationService.js'
import { createAbortError } from '../utils/abort.js'
import { setNdjsonStreamHeaders, writeStreamError, writeStreamEvent } from '../utils/ndjsonStream.js'
import {
  completeRequest,
  parseRequestId,
  registerRequest
} from '../utils/requestRegistry.js'

function writeNotFound(res) {
  res.status(404).json({
    message: '会话不存在'
  })
}

async function askConversation(req, res, next) {
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
    conversation = await findConversation(req.params.id)
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

  setNdjsonStreamHeaders(res)

  req.on('aborted', abortOnClientClose)
  res.on('close', abortOnClientClose)

  try {
    const writeDelta = (chunk) => {
      if (!writeStreamEvent(res, { type: 'delta', content: chunk })) {
        abortUpstream('write_closed')
        throw createAbortError()
      }
    }

    await generateConversationAnswer({
      conversation,
      conversationId: req.params.id,
      question,
      signal: requestController.signal,
      onDelta: writeDelta
    })

    writeStreamEvent(res, { type: 'done' })
  } catch (err) {
    if (abortReason || err?.name === 'AbortError') {
      console.info(
        `Ask request aborted: conversation=${req.params.id}, request=${requestId}, reason=${abortReason || 'abort_error'}`
      )
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
}

export {
  askConversation
}
