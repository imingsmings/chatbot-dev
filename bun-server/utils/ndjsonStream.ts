import type { HttpResponse } from '../http/types.ts'
import {
  CHAT_STREAM_PROTOCOL_HEADER,
  CHAT_STREAM_PROTOCOL_VERSION,
  type ChatStreamEvent
} from '../../shared/chatStreamProtocol.ts'

const HEARTBEAT_INTERVAL_MS = 5_000

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

async function startNdjsonHeartbeat(
  res: HttpResponse,
  onClosed: () => void,
  intervalMs = HEARTBEAT_INTERVAL_MS,
): Promise<() => Promise<void>> {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined

  const tick = async (): Promise<void> => {
    if (stopped) return
    let written = false
    try {
      if (!res.destroyed && !res.writableEnded) written = await res.write('\n')
    } catch {
      // A failed transport write must release the upstream request too.
      stopped = true
      onClosed()
      return
    }
    if (!written) {
      stopped = true
      onClosed()
      return
    }
    if (!stopped) {
      // Schedule only after backpressure clears; keep at most one write pending.
      timer = setTimeout(() => { pending = tick() }, intervalMs)
      timer.unref()
    }
  }

  await tick()
  return async () => {
    stopped = true
    clearTimeout(timer)
    await pending
  }
}

export {
  CHAT_STREAM_PROTOCOL_HEADER,
  CHAT_STREAM_PROTOCOL_VERSION,
  setNdjsonStreamHeaders,
  startNdjsonHeartbeat,
  writeStreamError,
  writeStreamEvent
}

export type {
  ChatStreamEvent as StreamEvent
}
