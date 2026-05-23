import type { Response } from 'express'

const CHAT_STREAM_PROTOCOL_HEADER = 'X-Chat-Stream-Protocol'
const CHAT_STREAM_PROTOCOL_VERSION = '1'

type StreamEvent =
  | {
      type: 'delta'
      content: string
    }
  | {
      type: 'reasoning_delta'
      content: string
    }
  | {
      type: 'done'
      reasoningDurationMs?: number
    }
  | {
      type: 'error'
      message: string
    }

function setNdjsonStreamHeaders(res: Response): void {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader(CHAT_STREAM_PROTOCOL_HEADER, CHAT_STREAM_PROTOCOL_VERSION)
}

function writeStreamEvent(res: Response, event: StreamEvent): boolean {
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
  StreamEvent
}
