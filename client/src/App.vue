<template>
  <div class="app-shell" :data-theme="theme">
    <ChatSidebar
      :conversations="conversations"
      :current-conversation-id="currentConversationId"
      :is-responding="isResponding"
      :theme-toggle-label="themeToggleLabel"
      @clear-conversation="handleClearCurrentConversation"
      @delete-conversation="handleDeleteConversation"
      @new-chat="startNewChat"
      @rename-conversation="handleRenameConversation"
      @select-conversation="selectConversation"
      @toggle-theme="toggleTheme"
    />

    <main class="chat-main">
      <div class="chat-scroll" ref="chatBox">
        <EmptyState
          v-if="messages.length === 0"
          :suggestions="suggestions"
          :title="currentConversationTitle"
          @use-suggestion="useSuggestion"
        />

        <MessageList
          v-else
          :copied-message-id="copiedMessageId"
          :is-responding="isResponding"
          :messages="messages"
          @copy-message="copyMessage"
          @retry-message="retryMessage"
        />
      </div>

      <ChatComposer
        ref="composer"
        v-model="input"
        :can-submit="canSubmit"
        :disabled="isResponding || !currentConversationId"
        :is-responding="isResponding"
        @stop="stopGenerating"
        @submit="handleSubmit"
      />
    </main>
  </div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import ChatComposer from '@/components/ChatComposer.vue'
import EmptyState from '@/components/EmptyState.vue'
import MessageList from '@/components/MessageList.vue'
import ChatSidebar from '@/components/ChatSidebar.vue'
import { useAutoScroll } from '@/composables/useAutoScroll'
import { useChatStream } from '@/composables/useChatStream'
import { useConversations } from '@/composables/useConversations'
import { useTheme } from '@/composables/useTheme'
import type { ConversationSummary } from '@/types/chat'

const input = ref('')
const chatBox = ref<HTMLElement | null>(null)
const composer = ref<InstanceType<typeof ChatComposer> | null>(null)

const suggestions = [
  '帮我总结一下今天的工作重点',
  '用简单例子解释一个技术概念',
  '帮我优化这段提示词',
  '给我一个学习计划',
]

const { applyTheme, theme, themeToggleLabel, toggleTheme } = useTheme()
const {
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
} = useConversations()
const { followNewContent, scrollChatToBottom, shouldFollowNewContent } = useAutoScroll(chatBox)

function resizeComposer() {
  composer.value?.resizeComposer()
}

function focusComposer() {
  composer.value?.focus()
}

function clearComposerDraft() {
  input.value = ''
}

const {
  copiedMessageId,
  copyMessage,
  isResponding,
  retryMessage,
  stopGenerating,
  submitQuestion,
} = useChatStream({
  clearComposer: () => {
    input.value = ''
  },
  createConversation: createNewConversation,
  currentConversationId,
  followNewContent,
  messages,
  refreshConversationList,
  resizeComposer,
  shouldFollowNewContent,
})

const canSubmit = computed(
  () =>
    Boolean(currentConversationId.value) && input.value.trim().length > 0 && !isResponding.value,
)

async function settleConversationView(options: { focus?: boolean; scroll?: boolean } = {}) {
  await nextTick()
  resizeComposer()

  if (options.scroll) {
    scrollChatToBottom()
  }

  if (options.focus) {
    focusComposer()
  }
}

async function startNewChat() {
  if (isResponding.value) {
    await stopGenerating()
  }

  try {
    await createNewConversation()
    clearComposerDraft()
    await settleConversationView({ focus: true })
  } catch (err) {
    console.error('Failed to create conversation:', err)
    alert('新建会话失败')
  }
}

async function selectConversation(id: string) {
  if (id === currentConversationId.value) {
    return
  }

  if (isResponding.value) {
    await stopGenerating()
  }

  try {
    await loadConversation(id)
    clearComposerDraft()
    await settleConversationView({ scroll: true })
  } catch (err) {
    console.error('Failed to select conversation:', err)
    alert('切换会话失败')
  }
}

async function handleRenameConversation(conversation: ConversationSummary) {
  const title = window.prompt('请输入新的会话名称', conversation.title)?.trim()

  if (!title || title === conversation.title) {
    return
  }

  try {
    await renameConversation(conversation, title)
  } catch (err) {
    console.error('Failed to rename conversation:', err)
    alert('重命名失败，请稍候再试')
  }
}

async function handleDeleteConversation(id: string) {
  if (isResponding.value) {
    return
  }

  const conversation = conversations.value.find((item) => item.id === id)
  const title = conversation?.title || '该会话'

  if (!confirm(`确定删除“${title}”吗？该操作不可逆`)) {
    return
  }

  try {
    await removeConversation(id)
    clearComposerDraft()
    await settleConversationView({ focus: true, scroll: true })
  } catch (err) {
    console.error('Failed to delete conversation:', err)
    alert('删除会话失败，请稍候再试')
  }
}

async function handleClearCurrentConversation() {
  if (!currentConversationId.value || isResponding.value) {
    return
  }

  if (!confirm('确定清空当前会话消息吗？会话名称会保留')) {
    return
  }

  try {
    await clearCurrentConversation()
    clearComposerDraft()
    await settleConversationView()
  } catch (err) {
    console.error('Failed to clear conversation:', err)
    alert('清空会话失败，请稍候再试')
  }
}

async function useSuggestion(suggestion: string) {
  input.value = suggestion
  await nextTick()
  resizeComposer()
  focusComposer()
}

async function handleSubmit() {
  const question = input.value.trim()

  await submitQuestion(question, { appendUser: true, clearComposer: true })
}

onMounted(async () => {
  applyTheme(theme.value)

  try {
    await loadInitialState()
    await settleConversationView({ scroll: true })
  } catch (err) {
    console.error('Failed to load conversations:', err)
    alert('加载会话失败，请刷新后重试')
  }
})
</script>

<style src="./assets/app.css"></style>
