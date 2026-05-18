<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div>
          <p class="sidebar-eyebrow">Chatbot</p>
          <h1>AI 助手</h1>
        </div>
        <button class="new-chat-btn" type="button" @click="startNewChat">新建</button>
      </div>

      <nav class="conversation-panel" aria-label="会话">
        <p class="section-label">会话</p>
        <div v-if="conversations.length === 0" class="empty-sidebar-state">暂无会话</div>
        <div
          v-for="conversation in conversations"
          :key="conversation.id"
          :class="['conversation-item-shell', { active: conversation.id === currentConversationId }]"
        >
          <button class="conversation-item" type="button" @click="selectConversation(conversation.id)">
            <span class="conversation-title">{{ conversation.title }}</span>
            <span class="conversation-meta">{{ conversation.messageCount }} 条消息</span>
          </button>
          <div class="conversation-actions">
            <button
              class="conversation-action-btn"
              type="button"
              title="重命名"
              @click="renameConversation(conversation)"
            >
              重命名
            </button>
            <button
              class="conversation-action-btn danger"
              type="button"
              title="删除"
              @click="deleteCurrentConversation(conversation.id)"
            >
              删除
            </button>
          </div>
        </div>
      </nav>

      <div class="sidebar-footer">
        <button
          class="clear-history-btn"
          type="button"
          :disabled="!currentConversationId || isResponding"
          @click="clearCurrentConversation"
        >
          清空当前会话
        </button>
      </div>
    </aside>

    <main class="chat-main">
      <div class="chat-scroll" ref="chatBox">
        <section v-if="messages.length === 0" class="empty-state">
          <div class="empty-mark">AI</div>
          <h2>{{ currentConversationTitle }}</h2>
          <div class="suggestion-grid">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion"
              class="suggestion-card"
              type="button"
              @click="useSuggestion(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>
        </section>

        <div v-else class="message-list">
          <article
            v-for="(msg, index) in messages"
            :key="msg.id"
            :class="['message-row', msg.role]"
          >
            <div class="message-avatar">{{ msg.role === 'user' ? '你' : 'AI' }}</div>
            <div class="message-content">
              <div class="message-name">{{ msg.role === 'user' ? '你' : 'AI 助手' }}</div>
              <div v-if="msg.status === 'pending'" class="message-text thinking-text">
                Thinking...
              </div>
              <div v-else-if="msg.status === 'error'" class="message-text error-text">
                {{ msg.error || '响应失败，请重试' }}
              </div>
              <div v-else-if="msg.role === 'user'" class="message-text">{{ msg.text }}</div>
              <MarkdownMessage
                v-else
                class="message-text"
                :content="msg.text"
                :streaming="msg.status === 'streaming'"
              />
              <div v-if="msg.role === 'assistant'" class="message-actions">
                <button
                  v-if="msg.text"
                  class="message-action-btn"
                  type="button"
                  @click="copyMessage(msg)"
                >
                  {{ copiedMessageId === msg.id ? '已复制' : '复制' }}
                </button>
                <button
                  v-if="msg.status === 'error'"
                  class="message-action-btn"
                  type="button"
                  :disabled="isResponding"
                  @click="retryMessage(index)"
                >
                  重试
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>

      <form class="composer" @submit.prevent="handleSubmit">
        <div class="composer-inner">
          <textarea
            ref="composerInput"
            v-model="input"
            rows="1"
            placeholder="询问任何问题"
            :disabled="isResponding || !currentConversationId"
            @input="resizeComposer"
            @keydown.enter.exact.prevent="handleSubmit"
          ></textarea>
          <button
            v-if="isResponding"
            class="send-btn stop-btn"
            type="button"
            aria-label="停止生成"
            @click="stopGenerating"
          >
            停止
          </button>
          <button
            v-else
            class="send-btn"
            type="submit"
            :disabled="!canSubmit"
            aria-label="发送消息"
          >
            发送
          </button>
        </div>
      </form>
    </main>
  </div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import MarkdownMessage from './components/MarkdownMessage.vue'

type MessageStatus = 'pending' | 'streaming' | 'done' | 'error'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  status: MessageStatus
  error?: string
}

type StoredMessage = {
  role: 'user' | 'assistant'
  content: string
}

type ConversationSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

type ConversationDetail = ConversationSummary & {
  titleManuallyEdited?: boolean
  messages: StoredMessage[]
}

const input = ref('')
const chatBox = ref<HTMLElement | null>(null)
const composerInput = ref<HTMLTextAreaElement | null>(null)
const conversations = ref<ConversationSummary[]>([])
const currentConversationId = ref<string | null>(null)
const messages = ref<ChatMessage[]>([])
const currentAbortController = ref<AbortController | null>(null)
const abortReason = ref<'manual' | 'timeout' | null>(null)
const copiedMessageId = ref<string | null>(null)
const STREAM_IDLE_TIMEOUT_MS = 15000
const SCROLL_FOLLOW_THRESHOLD = 96

const suggestions = [
  '帮我总结一下今天的工作重点',
  '用简单例子解释一个技术概念',
  '帮我优化这段提示词',
  '给我一个学习计划',
]

const isResponding = computed(() =>
  messages.value.some(
    (msg) => msg.role === 'assistant' && (msg.status === 'pending' || msg.status === 'streaming'),
  ),
)

const canSubmit = computed(
  () => Boolean(currentConversationId.value) && input.value.trim().length > 0 && !isResponding.value,
)

const currentConversationTitle = computed(() => {
  return (
    conversations.value.find((conversation) => conversation.id === currentConversationId.value)?.title ||
    '新的聊天'
  )
})

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

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
    status: 'done',
  }))
}

function upsertConversation(conversation: ConversationDetail | ConversationSummary) {
  const summary =
    'messages' in conversation ? conversationToSummary(conversation) : conversation
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

function scrollChatToBottom() {
  chatBox.value?.scrollTo({
    top: chatBox.value.scrollHeight,
    behavior: 'smooth',
  })
}

function shouldFollowNewContent() {
  const element = chatBox.value

  if (!element) {
    return true
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight < SCROLL_FOLLOW_THRESHOLD
}

async function followNewContent(shouldFollow: boolean) {
  if (!shouldFollow) {
    return
  }

  await nextTick()
  scrollChatToBottom()
}

function resizeComposer() {
  const element = composerInput.value

  if (!element) {
    return
  }

  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`
}

async function fetchConversationList() {
  const response = await fetch('/api/conversations')

  if (!response.ok) {
    throw new Error('获取会话列表失败')
  }

  const data = await response.json()
  conversations.value = data.conversations
}

async function refreshConversationList() {
  try {
    await fetchConversationList()
  } catch (err) {
    console.error('Failed to refresh conversations:', err)
  }
}

async function createConversation() {
  const response = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    throw new Error('新建会话失败')
  }

  const data = await response.json()
  const conversation = data.conversation as ConversationDetail
  upsertConversation(conversation)
  currentConversationId.value = conversation.id
  messages.value = []

  await nextTick()
  resizeComposer()
  composerInput.value?.focus()

  return conversation
}

async function loadConversation(id: string) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`)

  if (!response.ok) {
    throw new Error('获取会话详情失败')
  }

  const data = await response.json()
  const conversation = data.conversation as ConversationDetail
  currentConversationId.value = conversation.id
  messages.value = mapStoredMessages(conversation)
  upsertConversation(conversation)

  await nextTick()
  resizeComposer()
  scrollChatToBottom()
}

async function loadInitialState() {
  try {
    await fetchConversationList()

    if (conversations.value.length > 0) {
      await loadConversation(conversations.value[0].id)
    } else {
      await createConversation()
    }
  } catch (err) {
    console.error('Failed to load conversations:', err)
    alert('加载会话失败，请刷新后重试')
  }
}

async function startNewChat() {
  if (isResponding.value) {
    stopGenerating()
  }

  try {
    await createConversation()
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
    stopGenerating()
  }

  try {
    await loadConversation(id)
  } catch (err) {
    console.error('Failed to select conversation:', err)
    alert('切换会话失败')
  }
}

async function renameConversation(conversation: ConversationSummary) {
  const title = window.prompt('请输入新的会话名称', conversation.title)?.trim()

  if (!title || title === conversation.title) {
    return
  }

  try {
    const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })

    if (!response.ok) {
      throw new Error('重命名失败')
    }

    const data = await response.json()
    upsertConversation(data.conversation)
  } catch (err) {
    console.error('Failed to rename conversation:', err)
    alert('重命名失败，请稍候再试')
  }
}

async function deleteCurrentConversation(id: string) {
  if (isResponding.value) {
    return
  }

  const conversation = conversations.value.find((item) => item.id === id)
  const title = conversation?.title || '该会话'

  if (!confirm(`确定删除“${title}”吗？该操作不可逆`)) {
    return
  }

  try {
    const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error('删除失败')
    }

    conversations.value = conversations.value.filter((item) => item.id !== id)

    if (currentConversationId.value === id) {
      const nextConversation = conversations.value[0]
      if (nextConversation) {
        await loadConversation(nextConversation.id)
      } else {
        await createConversation()
      }
    }
  } catch (err) {
    console.error('Failed to delete conversation:', err)
    alert('删除会话失败，请稍候再试')
  }
}

async function clearCurrentConversation() {
  const conversationId = currentConversationId.value

  if (!conversationId || isResponding.value) {
    return
  }

  if (!confirm('确定清空当前会话消息吗？会话名称会保留')) {
    return
  }

  try {
    const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error('清空失败')
    }

    const data = await response.json()
    messages.value = []
    upsertConversation(data.conversation)
  } catch (err) {
    console.error('Failed to clear conversation:', err)
    alert('清空会话失败，请稍候再试')
  }
}

async function useSuggestion(suggestion: string) {
  input.value = suggestion
  await nextTick()
  resizeComposer()
  composerInput.value?.focus()
}

async function handleSubmit() {
  const question = input.value.trim()

  await submitQuestion(question, { appendUser: true, clearComposer: true })
}

async function submitQuestion(
  question: string,
  options: {
    appendUser: boolean
    clearComposer: boolean
    assistantInsertIndex?: number
  },
) {
  if (!question || isResponding.value) return

  let conversationId = currentConversationId.value
  if (!conversationId) {
    const conversation = await createConversation()
    conversationId = conversation.id
  }

  if (options.appendUser) {
    messages.value.push({
      id: createMessageId(),
      role: 'user',
      text: question,
      status: 'done',
    })
  }

  const assistantMessage = reactive<ChatMessage>({
    id: createMessageId(),
    role: 'assistant',
    text: '',
    status: 'pending',
  })

  if (typeof options.assistantInsertIndex === 'number') {
    messages.value.splice(options.assistantInsertIndex, 0, assistantMessage)
  } else {
    messages.value.push(assistantMessage)
  }

  if (options.clearComposer) {
    input.value = ''
  }

  const shouldFollow = shouldFollowNewContent()
  await nextTick()
  resizeComposer()
  await followNewContent(shouldFollow)

  const controller = new AbortController()
  let streamIdleTimer: number | undefined
  currentAbortController.value = controller
  abortReason.value = null

  const clearStreamIdleTimer = () => {
    if (streamIdleTimer !== undefined) {
      window.clearTimeout(streamIdleTimer)
      streamIdleTimer = undefined
    }
  }

  const resetStreamIdleTimer = () => {
    clearStreamIdleTimer()
    streamIdleTimer = window.setTimeout(() => {
      abortReason.value = 'timeout'
      controller.abort()
    }, STREAM_IDLE_TIMEOUT_MS)
  }

  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`请求失败：${res.status}`)
    }

    const reader = res.body?.getReader()
    if (!reader) {
      throw new Error('响应内容为空')
    }

    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let streamDone = false
    resetStreamIdleTimer()

    const handleStreamLine = (line: string) => {
      const text = line.trim()
      if (!text) return

      const data = JSON.parse(text)

      if (data.type === 'error') {
        throw new Error(data.message || '模型响应失败')
      }

      if (data.type === 'done') {
        streamDone = true
        return
      }

      const delta = data.type === 'delta' ? data.content : data.response
      if (typeof delta === 'string' && delta) {
        const shouldFollow = shouldFollowNewContent()
        assistantMessage.status = 'streaming'
        assistantMessage.text += delta
        void followNewContent(shouldFollow)
      }
    }

    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      resetStreamIdleTimer()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        handleStreamLine(line)
        if (streamDone) {
          await reader.cancel()
          break
        }
      }
    }

    buffer += decoder.decode()

    if (!streamDone && buffer.trim()) {
      handleStreamLine(buffer)
    }

    if (!assistantMessage.text.trim()) {
      throw new Error('模型未返回内容')
    }

    if (!streamDone) {
      throw new Error('响应未完整结束')
    }

    assistantMessage.status = 'done'
    await refreshConversationList()
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === 'AbortError'
        ? abortReason.value === 'manual'
          ? '已停止生成'
          : '响应超时或连接中断'
        : err instanceof Error
          ? err.message
          : '响应失败，请重试'

    if (assistantMessage.text.trim()) {
      assistantMessage.status = 'error'
      assistantMessage.error = `响应中断：${message}`
    } else {
      assistantMessage.status = 'error'
      assistantMessage.error = message
    }

    console.error('Failed to request model:', err)
  } finally {
    clearStreamIdleTimer()
    if (currentAbortController.value === controller) {
      currentAbortController.value = null
      abortReason.value = null
    }

    const shouldFollow = shouldFollowNewContent()
    await followNewContent(shouldFollow)
  }
}

function stopGenerating() {
  if (!currentAbortController.value) {
    return
  }

  abortReason.value = 'manual'
  currentAbortController.value.abort()
}

async function copyMessage(message: ChatMessage) {
  if (!message.text.trim()) {
    return
  }

  try {
    await navigator.clipboard.writeText(message.text)
    copiedMessageId.value = message.id
    window.setTimeout(() => {
      if (copiedMessageId.value === message.id) {
        copiedMessageId.value = null
      }
    }, 1600)
  } catch {
    alert('复制失败，请手动选择文本复制')
  }
}

async function retryMessage(index: number) {
  const failedMessage = messages.value[index]

  if (!failedMessage || failedMessage.role !== 'assistant' || failedMessage.status !== 'error') {
    return
  }

  const previousQuestion = [...messages.value]
    .slice(0, index)
    .reverse()
    .find((msg) => msg.role === 'user')

  if (!previousQuestion) {
    return
  }

  messages.value.splice(index, 1)
  await submitQuestion(previousQuestion.text, {
    appendUser: false,
    clearComposer: false,
    assistantInsertIndex: index,
  })
}

onMounted(() => {
  void loadInitialState()
})
</script>

<style src="./assets/app.css"></style>
