import { computed, ref } from 'vue'
import {
  clearConversation,
  createConversation,
  deleteConversation,
  getConversation,
  getConversations,
  updateConversationTitle,
} from '@/api/conversations'
import type { ChatMessage, ConversationDetail, ConversationSummary } from '@/types/chat'

function conversationToSummary(conversation: ConversationDetail): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  }
}

function mapStoredMessages(conversation: ConversationDetail): ChatMessage[] {
  return conversation.messages.map((message, index) => ({
    id: `${conversation.id}-${index}-${message.role}`,
    role: message.role,
    text: message.content,
    reasoningText: message.reasoningContent,
    reasoningDurationMs: message.reasoningDurationMs,
    status: 'done',
  }))
}

export function useConversations() {
  const conversations = ref<ConversationSummary[]>([])
  const currentConversationId = ref<string | null>(null)
  const messages = ref<ChatMessage[]>([])

  const currentConversationTitle = computed(() => {
    return (
      conversations.value.find((conversation) => conversation.id === currentConversationId.value)
        ?.title || '新的聊天'
    )
  })

  function upsertConversation(conversation: ConversationDetail | ConversationSummary) {
    const summary = 'messages' in conversation ? conversationToSummary(conversation) : conversation
    const index = conversations.value.findIndex((item) => item.id === summary.id)

    if (index === -1) {
      conversations.value.unshift(summary)
    } else {
      conversations.value[index] = summary
    }

    conversations.value.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  }

  async function fetchConversationList() {
    conversations.value = await getConversations()
  }

  async function refreshConversationList() {
    try {
      await fetchConversationList()
    } catch (err) {
      console.error('Failed to refresh conversations:', err)
    }
  }

  async function createNewConversation() {
    const conversation = await createConversation()
    upsertConversation(conversation)
    currentConversationId.value = conversation.id
    messages.value = []
    return conversation
  }

  async function loadConversation(id: string) {
    const conversation = await getConversation(id)
    currentConversationId.value = conversation.id
    messages.value = mapStoredMessages(conversation)
    upsertConversation(conversation)
    return conversation
  }

  async function loadInitialState() {
    await fetchConversationList()

    if (conversations.value.length > 0) {
      await loadConversation(conversations.value[0].id)
      return
    }

    await createNewConversation()
  }

  async function renameConversation(conversation: ConversationSummary, title: string) {
    const updatedConversation = await updateConversationTitle(conversation.id, title)
    upsertConversation(updatedConversation)
  }

  async function removeConversation(id: string) {
    await deleteConversation(id)
    conversations.value = conversations.value.filter((item) => item.id !== id)

    if (currentConversationId.value !== id) {
      return
    }

    const nextConversation = conversations.value[0]
    if (nextConversation) {
      await loadConversation(nextConversation.id)
      return
    }

    await createNewConversation()
  }

  async function clearCurrentConversation() {
    const conversationId = currentConversationId.value

    if (!conversationId) {
      return
    }

    const conversation = await clearConversation(conversationId)
    messages.value = []
    upsertConversation(conversation)
  }

  return {
    clearCurrentConversation,
    conversations,
    createNewConversation,
    currentConversationId,
    currentConversationTitle,
    loadConversation,
    loadInitialState,
    messages,
    refreshConversationList,
    removeConversation,
    renameConversation,
  }
}
