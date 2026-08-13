import type { MessageStatus, ToolActivity } from '#types/chat'
import type { ChatStreamEvent } from '#utils/streamProtocol'
import type { TimedChatStreamEvent } from '#utils/chatStreamEventBuffer'
import { settleRunningToolActivities } from '#utils/toolActivities'

export type ChatStreamState = {
  text: string
  reasoningText: string
  reasoningStartedAt: number | null
  reasoningDurationMs?: number
  status: MessageStatus
  error?: string
  toolActivities: ToolActivity[]
  streamDone: boolean
}

export function createInitialChatStreamState(): ChatStreamState {
  return {
    text: '',
    reasoningText: '',
    reasoningStartedAt: null,
    status: 'pending',
    toolActivities: [],
    streamDone: false,
  }
}

export function finalizeChatStreamState(
  state: ChatStreamState,
  now = Date.now(),
): ChatStreamState {
  if (!state.text.trim()) {
    throw new Error('模型未返回内容')
  }

  if (!state.streamDone) {
    throw new Error('响应未完整结束')
  }

  return {
    ...state,
    reasoningDurationMs:
      state.reasoningStartedAt !== null && state.reasoningDurationMs === undefined
        ? Math.max(0, now - state.reasoningStartedAt)
        : state.reasoningDurationMs,
    status: 'done',
    toolActivities: settleRunningToolActivities(
      state.toolActivities,
      'error',
      '未收到工具结果',
    ),
  }
}

export function interruptChatStreamState(
  state: ChatStreamState,
  message: string,
  reason: 'manual' | 'error',
): ChatStreamState {
  const isManual = reason === 'manual'

  return {
    ...state,
    status: isManual ? 'stopped' : 'error',
    error: isManual
      ? '已停止生成'
      : state.text.trim()
        ? `响应中断：${message}`
        : message,
    toolActivities: settleRunningToolActivities(
      state.toolActivities,
      isManual ? 'stopped' : 'error',
      isManual ? '已停止' : '执行中断',
    ),
  }
}

function reduceToolResult(
  state: ChatStreamState,
  event: Extract<ChatStreamEvent, { type: 'tool_result' }>,
): ChatStreamState {
  const activities = state.toolActivities
  let index = event.toolCallId
    ? activities.findIndex((activity) => activity.id === event.toolCallId)
    : -1

  if (!event.toolCallId) {
    for (let activityIndex = activities.length - 1; activityIndex >= 0; activityIndex -= 1) {
      const candidate = activities[activityIndex]
      if (candidate.name === event.name && candidate.status === 'running') {
        index = activityIndex
        break
      }
    }
  }

  const activity: ToolActivity = {
    id: event.toolCallId || (index >= 0 ? activities[index].id : `${event.name}-${activities.length}`),
    name: event.name,
    status: event.success ? 'success' : 'error',
    summary: event.summary,
  }

  return {
    ...state,
    status: 'streaming',
    toolActivities:
      index >= 0
        ? activities.map((item, itemIndex) => (itemIndex === index ? activity : item))
        : [...activities, activity],
  }
}

export function reduceChatStreamEvent(
  state: ChatStreamState,
  event: ChatStreamEvent,
  now = Date.now(),
): ChatStreamState {
  switch (event.type) {
    case 'delta':
      if (!event.content) return state
      return {
        ...state,
        text: `${state.text}${event.content}`,
        reasoningDurationMs:
          state.reasoningStartedAt !== null && state.reasoningDurationMs === undefined
            ? Math.max(0, now - state.reasoningStartedAt)
            : state.reasoningDurationMs,
        status: 'streaming',
      }
    case 'reasoning_delta':
      if (!event.content) return state
      return {
        ...state,
        reasoningText: `${state.reasoningText}${event.content}`,
        reasoningStartedAt: state.reasoningStartedAt ?? now,
        status: 'streaming',
      }
    case 'tool_start': {
      const activity: ToolActivity = {
        id: event.toolCallId || `${event.name}-${state.toolActivities.length}`,
        name: event.name,
        status: 'running',
      }
      return {
        ...state,
        status: 'streaming',
        toolActivities: [...state.toolActivities, activity],
      }
    }
    case 'tool_result':
      return reduceToolResult(state, event)
    case 'done':
      return {
        ...state,
        reasoningDurationMs: event.reasoningDurationMs ?? state.reasoningDurationMs,
        streamDone: true,
      }
    case 'error':
      return {
        ...state,
        error: event.message,
        status: 'error',
        toolActivities: settleRunningToolActivities(
          state.toolActivities,
          'error',
          '执行中断',
        ),
      }
  }
}

export function reduceChatStreamEvents(
  state: ChatStreamState,
  events: TimedChatStreamEvent[],
): ChatStreamState {
  return events.reduce(
    (current, item) => reduceChatStreamEvent(current, item.event, item.receivedAt),
    state,
  )
}
