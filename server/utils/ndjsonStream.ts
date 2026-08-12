import type { Response } from 'express'
import {
  CHAT_STREAM_PROTOCOL_HEADER,
  CHAT_STREAM_PROTOCOL_VERSION,
  type ChatStreamEvent
} from '../../shared/chatStreamProtocol.ts'

function setNdjsonStreamHeaders(res: Response): void {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader(CHAT_STREAM_PROTOCOL_HEADER, CHAT_STREAM_PROTOCOL_VERSION)
}

function writeStreamEvent(res: Response, event: ChatStreamEvent): boolean {
  if (res.destroyed || res.writableEnded) {
    return false
  }

  res.write(`${JSON.stringify(event)}\n`)
  return true
}

function writeStreamError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : '模型响应失败'
  writeStreamEvent(res, {
    type: 'error',
    message
  })
}

export {
  CHAT_STREAM_PROTOCOL_HEADER,
  CHAT_STREAM_PROTOCOL_VERSION,
  setNdjsonStreamHeaders,
  writeStreamError,
  writeStreamEvent
}

export type {
  ChatStreamEvent as StreamEvent
}
