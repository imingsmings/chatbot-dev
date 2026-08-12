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
