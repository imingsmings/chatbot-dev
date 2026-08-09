export const CHAT_STREAM_PROTOCOL_HEADER = 'X-Chat-Stream-Protocol'
export const CHAT_STREAM_PROTOCOL_VERSION = '2'

export type ChatStreamEvent =
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
  | {
      type: 'tool_start'
      toolCallId?: string
      name: string
    }
  | {
      type: 'tool_result'
      toolCallId?: string
      name: string
      summary: string
      success: boolean
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertContentEvent(value: Record<string, unknown>): ChatStreamEvent {
  if (typeof value.content !== 'string') {
    throw new Error('服务端返回了无效的流式内容')
  }

  return {
    type: value.type as 'delta' | 'reasoning_delta',
    content: value.content,
  }
}

export function parseChatStreamEvent(line: string): ChatStreamEvent {
  const value = JSON.parse(line) as unknown

  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('服务端返回了不支持的流式事件')
  }

  switch (value.type) {
    case 'delta':
    case 'reasoning_delta':
      return assertContentEvent(value)
    case 'done':
      if (
        value.reasoningDurationMs !== undefined &&
        (typeof value.reasoningDurationMs !== 'number' ||
          !Number.isFinite(value.reasoningDurationMs) ||
          value.reasoningDurationMs < 0)
      ) {
        throw new Error('服务端返回了无效的完成事件')
      }

      return {
        type: 'done',
        reasoningDurationMs: value.reasoningDurationMs,
      }
    case 'error':
      if (typeof value.message !== 'string' || !value.message.trim()) {
        throw new Error('服务端返回了无效的错误事件')
      }

      return {
        type: 'error',
        message: value.message,
      }
    case 'tool_start':
      if (
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        (value.toolCallId !== undefined &&
          (typeof value.toolCallId !== 'string' || !value.toolCallId.trim()))
      ) {
        throw new Error('服务端返回了无效的工具开始事件')
      }
      return {
        type: 'tool_start',
        toolCallId: value.toolCallId,
        name: value.name,
      }
    case 'tool_result':
      if (
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        typeof value.summary !== 'string' ||
        typeof value.success !== 'boolean' ||
        (value.toolCallId !== undefined &&
          (typeof value.toolCallId !== 'string' || !value.toolCallId.trim()))
      ) {
        throw new Error('服务端返回了无效的工具结果事件')
      }
      return {
        type: 'tool_result',
        toolCallId: value.toolCallId,
        name: value.name,
        summary: value.summary,
        success: value.success,
      }
    default:
      throw new Error(`不支持的流式事件类型：${value.type}`)
  }
}

export function assertChatStreamProtocol(response: Response): void {
  const version = response.headers.get(CHAT_STREAM_PROTOCOL_HEADER)

  if (version !== CHAT_STREAM_PROTOCOL_VERSION) {
    throw new Error(`不支持的流式协议版本：${version || 'unknown'}`)
  }
}
