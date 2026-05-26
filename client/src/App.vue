<template>
  <div class="app-shell" :data-theme="theme">
    <ChatSidebar
      :conversations="visibleConversations"
      :current-conversation-id="currentConversationId"
      :is-searching="isConversationSearching"
      :is-responding="isResponding"
      :search-error="conversationSearchError"
      :search-query="conversationSearchQuery"
      :theme-toggle-label="themeToggleLabel"
      @clear-conversation="handleClearCurrentConversation"
      @delete-conversation="handleDeleteConversation"
      @export-all-conversations="handleExportAllConversations"
      @export-conversation="handleExportConversation"
      @new-chat="startNewChat"
      @rename-conversation="handleRenameConversation"
      @select-conversation="selectConversation"
      @toggle-theme="toggleTheme"
      @update-search-query="handleConversationSearchQuery"
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
        :can-preview-context="canPreviewContext"
        :disabled="isResponding || !currentConversationId"
        :is-context-preview-loading="isContextPreviewLoading"
        :is-responding="isResponding"
        @preview-context="openContextPreview"
        @stop="stopGenerating"
        @submit="handleSubmit"
      />
    </main>

    <AppDialog
      :cancel-label="dialog.cancelLabel"
      :confirm-label="dialog.confirmLabel"
      :danger="dialog.danger"
      :initial-value="dialog.initialValue"
      :message="dialog.message"
      :mode="dialog.mode"
      :open="dialog.open"
      :title="dialog.title"
      @cancel="handleDialogCancel"
      @confirm="handleDialogConfirm"
    />

    <ContextDebugModal
      :context="contextPreview"
      :open="isContextPreviewOpen"
      @close="closeContextPreview"
    />
  </div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  downloadAllConversationsJson,
  downloadConversationMarkdown,
  getConversationContextPreview,
  searchConversations,
} from '@/api/conversations'
import AppDialog from '@/components/AppDialog.vue'
import ChatComposer from '@/components/ChatComposer.vue'
import ContextDebugModal from '@/components/ContextDebugModal.vue'
import EmptyState from '@/components/EmptyState.vue'
import MessageList from '@/components/MessageList.vue'
import ChatSidebar from '@/components/ChatSidebar.vue'
import { useAutoScroll } from '@/composables/useAutoScroll'
import { useChatStream } from '@/composables/useChatStream'
import { useConversations } from '@/composables/useConversations'
import { useTheme } from '@/composables/useTheme'
import type {
  ContextPreview,
  ConversationSearchResult,
  ConversationSummary,
} from '@/types/chat'
import type { DownloadedFile } from '@/api/conversations'

type DialogMode = 'alert' | 'confirm' | 'prompt'

type DialogState = {
  cancelLabel: string
  confirmLabel: string
  danger: boolean
  initialValue: string
  message: string
  mode: DialogMode
  open: boolean
  title: string
}

const input = ref('')
const chatBox = ref<HTMLElement | null>(null)
const composer = ref<InstanceType<typeof ChatComposer> | null>(null)
const contextPreview = ref<ContextPreview | null>(null)
const isContextPreviewLoading = ref(false)
const isContextPreviewOpen = ref(false)
const conversationSearchQuery = ref('')
const conversationSearchResults = ref<ConversationSearchResult[]>([])
const conversationSearchError = ref('')
const isConversationSearching = ref(false)
const dialog = ref<DialogState>({
  cancelLabel: '取消',
  confirmLabel: '确定',
  danger: false,
  initialValue: '',
  message: '',
  mode: 'alert',
  open: false,
  title: '',
})
let resolveDialog: ((value: string | boolean | null) => void) | null = null
let conversationSearchRequestId = 0

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
const visibleConversations = computed(() =>
  conversationSearchQuery.value.trim() ? conversationSearchResults.value : conversations.value,
)

function resizeComposer() {
  composer.value?.resizeComposer()
}

function focusComposer() {
  composer.value?.focus()
}

function clearComposerDraft() {
  input.value = ''
}

function openDialog(options: Partial<DialogState> & Pick<DialogState, 'message' | 'mode' | 'title'>) {
  resolveDialog?.(null)
  dialog.value = {
    cancelLabel: '取消',
    confirmLabel: options.mode === 'alert' ? '知道了' : '确定',
    danger: false,
    initialValue: '',
    ...options,
    open: true,
  }

  return new Promise<string | boolean | null>((resolve) => {
    resolveDialog = resolve
  })
}

function closeDialog() {
  dialog.value.open = false
  resolveDialog = null
}

function handleDialogCancel() {
  resolveDialog?.(null)
  closeDialog()
}

function handleDialogConfirm(value: string | true) {
  resolveDialog?.(value)
  closeDialog()
}

async function showError(message: string, title = '操作失败') {
  await openDialog({
    message,
    mode: 'alert',
    title,
  })
}

function saveDownloadedFile(file: DownloadedFile) {
  const url = URL.createObjectURL(file.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function confirmAction(options: {
  confirmLabel?: string
  danger?: boolean
  message: string
  title: string
}) {
  const result = await openDialog({
    cancelLabel: '取消',
    confirmLabel: options.confirmLabel ?? '确定',
    danger: options.danger ?? false,
    message: options.message,
    mode: 'confirm',
    title: options.title,
  })

  return result === true
}

async function promptText(options: {
  initialValue: string
  message: string
  title: string
}) {
  const result = await openDialog({
    confirmLabel: '保存',
    initialValue: options.initialValue,
    message: options.message,
    mode: 'prompt',
    title: options.title,
  })

  return typeof result === 'string' ? result.trim() : null
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
  refreshConversationList: refreshConversationListAndSearch,
  resizeComposer,
  shouldFollowNewContent,
  showError,
})

const canSubmit = computed(
  () =>
    Boolean(currentConversationId.value) && input.value.trim().length > 0 && !isResponding.value,
)
const canPreviewContext = computed(
  () => Boolean(currentConversationId.value) && !isResponding.value,
)

function clearConversationSearch() {
  conversationSearchQuery.value = ''
  conversationSearchResults.value = []
  conversationSearchError.value = ''
  isConversationSearching.value = false
  conversationSearchRequestId += 1
}

async function runConversationSearch(query: string) {
  const trimmedQuery = query.trim()
  const requestId = ++conversationSearchRequestId

  if (!trimmedQuery) {
    conversationSearchResults.value = []
    conversationSearchError.value = ''
    isConversationSearching.value = false
    return
  }

  isConversationSearching.value = true
  conversationSearchError.value = ''

  try {
    const results = await searchConversations(trimmedQuery)

    if (requestId !== conversationSearchRequestId) {
      return
    }

    conversationSearchResults.value = results
  } catch (err) {
    if (requestId !== conversationSearchRequestId) {
      return
    }

    console.error('Failed to search conversations:', err)
    conversationSearchResults.value = []
    conversationSearchError.value = '搜索失败'
  } finally {
    if (requestId === conversationSearchRequestId) {
      isConversationSearching.value = false
    }
  }
}

function handleConversationSearchQuery(query: string) {
  conversationSearchQuery.value = query
  void runConversationSearch(query)
}

async function refreshActiveConversationSearch() {
  if (!conversationSearchQuery.value.trim()) {
    return
  }

  await runConversationSearch(conversationSearchQuery.value)
}

async function refreshConversationListAndSearch() {
  await refreshConversationList()
  await refreshActiveConversationSearch()
}

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
    clearConversationSearch()
    clearComposerDraft()
    await settleConversationView({ focus: true })
  } catch (err) {
    console.error('Failed to create conversation:', err)
    await showError('新建会话失败')
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
    await showError('切换会话失败')
  }
}

async function handleRenameConversation(conversation: ConversationSummary) {
  const title = await promptText({
    initialValue: conversation.title,
    message: '请输入新的会话名称',
    title: '重命名会话',
  })

  if (!title || title === conversation.title) {
    return
  }

  try {
    await renameConversation(conversation, title)
    await refreshActiveConversationSearch()
  } catch (err) {
    console.error('Failed to rename conversation:', err)
    await showError('重命名失败，请稍候再试')
  }
}

async function handleDeleteConversation(id: string) {
  if (isResponding.value) {
    return
  }

  const conversation = conversations.value.find((item) => item.id === id)
  const title = conversation?.title || '该会话'

  if (!(await confirmAction({
    confirmLabel: '删除',
    danger: true,
    message: `确定删除“${title}”吗？该操作不可逆`,
    title: '删除会话',
  }))) {
    return
  }

  try {
    await removeConversation(id)
    await refreshActiveConversationSearch()
    clearComposerDraft()
    await settleConversationView({ focus: true, scroll: true })
  } catch (err) {
    console.error('Failed to delete conversation:', err)
    await showError('删除会话失败，请稍候再试')
  }
}

async function handleClearCurrentConversation() {
  if (!currentConversationId.value || isResponding.value) {
    return
  }

  if (!(await confirmAction({
    confirmLabel: '清空',
    danger: true,
    message: '确定清空当前会话消息吗？会话名称会保留',
    title: '清空当前会话',
  }))) {
    return
  }

  try {
    await clearCurrentConversation()
    await refreshActiveConversationSearch()
    clearComposerDraft()
    await settleConversationView()
  } catch (err) {
    console.error('Failed to clear conversation:', err)
    await showError('清空会话失败，请稍候再试')
  }
}

async function handleExportConversation(conversation: ConversationSummary) {
  try {
    saveDownloadedFile(await downloadConversationMarkdown(conversation.id))
  } catch (err) {
    console.error('Failed to export conversation:', err)
    await showError('导出会话失败，请稍候再试')
  }
}

async function handleExportAllConversations() {
  try {
    saveDownloadedFile(await downloadAllConversationsJson())
  } catch (err) {
    console.error('Failed to export all conversations:', err)
    await showError('导出全部会话失败，请稍候再试')
  }
}

async function openContextPreview() {
  const conversationId = currentConversationId.value

  if (!conversationId || isResponding.value || isContextPreviewLoading.value) {
    return
  }

  isContextPreviewLoading.value = true

  try {
    contextPreview.value = await getConversationContextPreview(conversationId, input.value.trim())
    isContextPreviewOpen.value = true
  } catch (err) {
    console.error('Failed to preview context:', err)
    await showError('上下文预览失败，请稍候再试')
  } finally {
    isContextPreviewLoading.value = false
  }
}

function closeContextPreview() {
  isContextPreviewOpen.value = false
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
    await showError('加载会话失败，请刷新后重试')
  }
})
</script>

<style src="./assets/app.css"></style>
