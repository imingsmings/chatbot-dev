import type { Response } from 'express'

type StreamEvent =
  | {
      type: 'delta'
      content: string
    }
  | {
      type: 'done'
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
  setNdjsonStreamHeaders,
  writeStreamError,
  writeStreamEvent
}
