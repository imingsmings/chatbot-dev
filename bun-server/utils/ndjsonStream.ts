import type { HttpResponse } from '../http/types.ts'
import {
  CHAT_STREAM_PROTOCOL_HEADER,
  CHAT_STREAM_PROTOCOL_VERSION,
  type ChatStreamEvent
} from '../../shared/chatStreamProtocol.ts'

function setNdjsonStreamHeaders(res: HttpResponse): void {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader(CHAT_STREAM_PROTOCOL_HEADER, CHAT_STREAM_PROTOCOL_VERSION)
  res.startStream()
}

async function writeStreamEvent(res: HttpResponse, event: ChatStreamEvent): Promise<boolean> {
  if (res.destroyed || res.writableEnded) {
    return false
  }

  return res.write(`${JSON.stringify(event)}\n`)
}

async function writeStreamError(res: HttpResponse, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : '模型响应失败'
  await writeStreamEvent(res, {
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
