import type {
  ChatMessage,
  ConversationContextSummary,
  ConversationDetail,
  ConversationModelOptions,
  ConversationSummary,
} from '#types/chat'

export type ConversationState = {
  conversations: ConversationSummary[]
  currentConversationId: string | null
  currentConversationSummary?: ConversationContextSummary
  currentConversationModelOptions?: ConversationModelOptions
  messages: ChatMessage[]
}

export type ConversationAction =
  | { type: 'replace-conversations'; conversations: ConversationSummary[] }
  | { type: 'select-conversation'; conversation: ConversationDetail }
  | { type: 'upsert-conversation'; conversation: ConversationDetail | ConversationSummary }
  | { type: 'apply-conversation-detail'; conversation: ConversationDetail }
  | { type: 'remove-conversation'; conversationId: string }
  | { type: 'clear-current-conversation'; conversation: ConversationDetail }
  | { type: 'set-messages'; messages: ChatMessage[] }
  | { type: 'append-message'; message: ChatMessage }
  | { type: 'insert-message'; index: number; message: ChatMessage }
  | { type: 'replace-message'; message: ChatMessage }
  | { type: 'remove-message'; messageId: string }

export function createInitialConversationState(): ConversationState {
  return {
    conversations: [],
    currentConversationId: null,
    messages: [],
  }
}

export function conversationToSummary(
  conversation: ConversationDetail | ConversationSummary,
): ConversationSummary {
  if (!('messages' in conversation)) {
    return conversation
  }

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  }
}

export function mapStoredMessages(conversation: ConversationDetail): ChatMessage[] {
  return conversation.messages.map((message, index) => ({
    id: `${conversation.id}-${index}-${message.role}`,
    persistedIndex: index,
    role: message.role,
    text: message.content,
    reasoningText: message.reasoningContent,
    reasoningDurationMs: message.reasoningDurationMs,
    status: message.status === 'stopped' ? 'stopped' : 'done',
    generation: message.generation,
    toolActivities: message.toolTrace?.map((trace, traceIndex) => ({
      id: `${conversation.id}-${index}-tool-${traceIndex}`,
      name: trace.name,
      status: trace.success ? 'success' : 'error',
      summary: trace.summary,
      durationMs: trace.durationMs,
    })),
  }))
}

function sortConversations(conversations: ConversationSummary[]): ConversationSummary[] {
  return [...conversations].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )
}

function upsertConversation(
  conversations: ConversationSummary[],
  conversation: ConversationDetail | ConversationSummary,
): ConversationSummary[] {
  const summary = conversationToSummary(conversation)
  const existingIndex = conversations.findIndex((item) => item.id === summary.id)

  if (existingIndex === -1) {
    return sortConversations([summary, ...conversations])
  }

  return sortConversations(
    conversations.map((item, index) => (index === existingIndex ? summary : item)),
  )
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'replace-conversations':
      return {
        ...state,
        conversations: [...action.conversations],
      }
    case 'select-conversation':
      return {
        conversations: upsertConversation(state.conversations, action.conversation),
        currentConversationId: action.conversation.id,
        currentConversationSummary: action.conversation.summary,
        currentConversationModelOptions: action.conversation.modelOptions,
        messages: mapStoredMessages(action.conversation),
      }
    case 'upsert-conversation':
      return {
        ...state,
        conversations: upsertConversation(state.conversations, action.conversation),
      }
    case 'apply-conversation-detail':
      return {
        ...state,
        conversations: upsertConversation(state.conversations, action.conversation),
        currentConversationSummary:
          action.conversation.id === state.currentConversationId
            ? action.conversation.summary
            : state.currentConversationSummary,
        currentConversationModelOptions:
          action.conversation.id === state.currentConversationId
            ? action.conversation.modelOptions
            : state.currentConversationModelOptions,
      }
    case 'remove-conversation': {
      const conversations = state.conversations.filter(
        (conversation) => conversation.id !== action.conversationId,
      )

      if (state.currentConversationId !== action.conversationId) {
        return {
          ...state,
          conversations,
        }
      }

      return {
        conversations,
        currentConversationId: null,
        currentConversationSummary: undefined,
        currentConversationModelOptions: undefined,
        messages: [],
      }
    }
    case 'clear-current-conversation':
      return {
        conversations: upsertConversation(state.conversations, action.conversation),
        currentConversationId: action.conversation.id,
        currentConversationSummary: undefined,
        currentConversationModelOptions: action.conversation.modelOptions,
        messages: [],
      }
    case 'set-messages':
      return {
        ...state,
        messages: [...action.messages],
      }
    case 'append-message':
      return {
        ...state,
        messages: [...state.messages, action.message],
      }
    case 'insert-message': {
      const index = Math.max(0, Math.min(action.index, state.messages.length))
      return {
        ...state,
        messages: [
          ...state.messages.slice(0, index),
          action.message,
          ...state.messages.slice(index),
        ],
      }
    }
    case 'replace-message':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.message.id ? action.message : message,
        ),
      }
    case 'remove-message':
      return {
        ...state,
        messages: state.messages.filter((message) => message.id !== action.messageId),
      }
  }
}
