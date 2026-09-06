import crypto from 'node:crypto'
import { generateConversationAnswer } from '../services/chatService.ts'
import { findConversation } from '../services/conversationService.ts'
import { createAbortError } from '../utils/abort.ts'
import { setNdjsonStreamHeaders, writeStreamError, writeStreamEvent } from '../utils/ndjsonStream.ts'
import {
  completeRequest,
  isRequestActive,
  parseRequestId,
  registerRequest
} from '../utils/requestRegistry.ts'
import {
  beginConversationRequest,
  finalizeConversationRequest,
  findConversationRequest
} from '../utils/conversationStore.ts'
import { parseModelRequestOptions, resolveModelOptions } from '../utils/modelOptions.ts'
import { MAX_IMAGE_ATTACHMENTS_PER_MESSAGE, MAX_QUESTION_LENGTH } from '../config/productLimits.ts'
import { findModelDescriptor } from '../utils/llm/modelCatalog.ts'
import {
  AttachmentError,
  resolveConversationAttachments,
} from '../services/attachmentService.ts'
import type { LlmStreamChunkType } from '../types/llm.ts'
import type { ImageAttachment } from '../types/conversation.ts'
import type { ToolExecutionEvent } from '../types/tools.ts'
import type { HttpResponse, RequestHandler } from '../http/types.ts'

type AskConversationParams = {
  id: string
}

type AskConversationBody = {
  question?: unknown
  requestId?: unknown
  options?: unknown
  attachmentIds?: unknown
}

function canonicalizeRequestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeRequestValue)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalizeRequestValue(item)])
  )
}

function createRequestHash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalizeRequestValue(value)))
    .digest('hex')
}

async function writeTerminalReplay(res: HttpResponse): Promise<void> {
  setNdjsonStreamHeaders(res)
  await writeStreamEvent(res, { type: 'done' })
  await res.end()
}

function writeNotFound(res: HttpResponse): void {
  res.status(404).json({
    message: '会话不存在'
  })
}

const askConversation: RequestHandler<AskConversationParams, unknown, AskConversationBody> = async (
  req,
  res,
  next
) => {
  const question = typeof req.body.question === 'string' ? req.body.question.trim() : ''
  const requestId = parseRequestId(req.body.requestId)
  let modelOptions
  let conversation
  let attachments: ImageAttachment[] = []
  const requestController = new AbortController()
  let abortReason: string | null = null

  if (!requestId) {
    res.status(400).json({
      message: 'requestId 不合法'
    })
    return
  }

  if (
    req.body.attachmentIds !== undefined &&
    (!Array.isArray(req.body.attachmentIds) ||
      req.body.attachmentIds.length > MAX_IMAGE_ATTACHMENTS_PER_MESSAGE ||
      req.body.attachmentIds.some((id) => typeof id !== 'string'))
  ) {
    res.status(400).json({
      message: `attachmentIds 必须是最多 ${MAX_IMAGE_ATTACHMENTS_PER_MESSAGE} 个字符串组成的数组`
    })
    return
  }
  const attachmentIds = (req.body.attachmentIds ?? []) as string[]

  if (!question && attachmentIds.length === 0) {
    res.status(400).json({
      message: '问题和图片不能同时为空'
    })
    return
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    res.status(400).json({
      message: `问题不能超过 ${MAX_QUESTION_LENGTH} 个字符`
    })
    return
  }

  const requestHash = createRequestHash({
    question,
    attachmentIds,
    options: req.body.options ?? null
  })
  const persistedRequest = await findConversationRequest(requestId)
  if (persistedRequest) {
    if (
      persistedRequest.conversationId !== req.params.id ||
      persistedRequest.request.requestHash !== requestHash
    ) {
      res.status(409).json({ message: 'requestId 已绑定到其他请求' })
      return
    }
    if (persistedRequest.request.status === 'processing' && !isRequestActive(requestId)) {
      await finalizeConversationRequest(req.params.id, requestId, 'failed')
      res.status(409).json({ message: '请求在服务重启或连接中断后未完成' })
      return
    }
    if (persistedRequest.request.status === 'processing') {
      res.status(409).json({ message: 'requestId 或会话正在处理中' })
      return
    }
    if (
      persistedRequest.request.status === 'completed' ||
      persistedRequest.request.status === 'stopped'
    ) {
      await writeTerminalReplay(res)
      return
    }
    res.status(409).json({ message: '该 requestId 对应的请求已失败，请使用新的 requestId 重试' })
    return
  }

  try {
    modelOptions = parseModelRequestOptions(req.body.options)
  } catch (err) {
    res.status(400).json({
      message: err instanceof Error ? err.message : '模型参数不合法'
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

  try {
    attachments = await resolveConversationAttachments(req.params.id, attachmentIds)
    if (attachments.length) {
      const effectiveOptions = resolveModelOptions(modelOptions)
      const descriptor = findModelDescriptor(effectiveOptions.model)
      if (!descriptor?.capabilities.inputModalities.includes('image')) {
        res.status(400).json({
          message: `${descriptor?.label ?? effectiveOptions.model} 不支持图片，请切换到 Vision 模型`
        })
        return
      }
    }
  } catch (error) {
    if (error instanceof AttachmentError) {
      res.status(error.status).json({ message: error.message })
      return
    }
    next(error)
    return
  }
  const abortUpstream = (reason = 'client_closed'): void => {
    if (requestController.signal.aborted) {
      return
    }

    abortReason = reason
    requestController.abort(reason)
  }

  const abortOnClientClose = (): void => {
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
      message: 'requestId 或会话正在处理中'
    })
    return
  }
  const startedAt = new Date().toISOString()
  let storedRequest: Awaited<ReturnType<typeof beginConversationRequest>>
  try {
    storedRequest = await beginConversationRequest(req.params.id, {
      requestId,
      requestHash,
      status: 'processing',
      createdAt: startedAt,
      updatedAt: startedAt
    })
  } catch (error) {
    completeRequest(requestId, requestController)
    next(error)
    return
  }
  if (!storedRequest) {
    completeRequest(requestId, requestController)
    writeNotFound(res)
    return
  }

  setNdjsonStreamHeaders(res)

  req.on('aborted', abortOnClientClose)
  res.on('close', abortOnClientClose)

  try {
    const writeDelta = async (chunk: string, type: LlmStreamChunkType): Promise<void> => {
      const eventType = type === 'reasoning' ? 'reasoning_delta' : 'delta'

      if (!await writeStreamEvent(res, { type: eventType, content: chunk })) {
        abortUpstream('write_closed')
        throw createAbortError()
      }
    }
    const writeToolEvent = async (event: ToolExecutionEvent): Promise<void> => {
      const streamEvent = event.type === 'tool_start'
        ? {
            type: 'tool_start' as const,
            toolCallId: event.toolCallId,
            name: event.name
          }
        : {
            type: 'tool_result' as const,
            toolCallId: event.toolCallId,
            name: event.name,
            summary: event.summary,
            success: event.success
          }

      if (!await writeStreamEvent(res, streamEvent)) {
        abortUpstream('write_closed')
        throw createAbortError()
      }
    }

    const answer = await generateConversationAnswer({
      conversation,
      conversationId: req.params.id,
      question,
      attachments,
      signal: requestController.signal,
      onDelta: writeDelta,
      onToolEvent: writeToolEvent,
      modelOptions,
      requestId
    })

    await writeStreamEvent(res, { type: 'done', reasoningDurationMs: answer.reasoningDurationMs })
  } catch (err: unknown) {
    if (abortReason || (err instanceof Error && err.name === 'AbortError')) {
      console.info(
        `Ask request aborted: conversation=${req.params.id}, request=${requestId}, reason=${abortReason || 'abort_error'}`
      )
      return
    }

    console.error(`Failed to handle ask request:`, err)
    await writeStreamError(res, err)
  } finally {
    req.off('aborted', abortOnClientClose)
    res.off('close', abortOnClientClose)
    const persisted = await findConversationRequest(requestId).catch(() => null)
    if (persisted?.request.status === 'processing') {
      await finalizeConversationRequest(
        req.params.id,
        requestId,
        abortReason === 'explicit_cancel' ? 'stopped' : 'failed'
      ).catch((error) => {
        console.error('Failed to persist request terminal status:', error)
      })
    }
    completeRequest(requestId, requestController)

    if (!res.destroyed && !res.writableEnded) {
      await res.end()
    }
  }
}

export {
  askConversation
}
