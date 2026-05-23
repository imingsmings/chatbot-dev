<template>
  <div class="message-list">
    <article
      v-for="(msg, index) in messages"
      :key="msg.id"
      :class="['message-row', msg.role, { pending: msg.status === 'pending' }]"
    >
      <div v-if="msg.role === 'assistant'" class="message-avatar">AI</div>
      <div class="message-content">
        <details
          v-if="msg.role === 'assistant' && msg.reasoningText"
          class="reasoning-panel"
          :open="msg.status === 'streaming'"
        >
          <summary class="reasoning-summary">
            {{ getReasoningLabel(msg) }}
          </summary>
          <div class="reasoning-content">
            <div class="reasoning-content-body">{{ msg.reasoningText.trim() }}</div>
          </div>
        </details>
        <div v-if="msg.status === 'pending'" class="message-text thinking-text">Thinking...</div>
        <div v-else-if="msg.status === 'error' && !msg.text" class="message-text error-text">
          {{ msg.error || '响应失败，请重试' }}
        </div>
        <div v-else-if="msg.role === 'user'" class="message-text">{{ msg.text }}</div>
        <MarkdownMessage
          v-else-if="msg.text"
          class="message-text"
          :content="msg.text"
          :streaming="msg.status === 'streaming'"
        />
        <div v-if="msg.status === 'error' && msg.text" class="message-status-text error-text">
          {{ msg.error || '响应失败，请重试' }}
        </div>
        <div v-if="msg.status === 'stopped'" class="message-status-text">已停止生成</div>
        <div v-if="msg.role === 'assistant'" class="message-actions">
          <button
            v-if="msg.text && msg.status !== 'pending' && msg.status !== 'streaming'"
            class="message-action-btn"
            type="button"
            @click="$emit('copyMessage', msg)"
          >
            {{ copiedMessageId === msg.id ? '已复制' : '复制' }}
          </button>
          <button
            v-if="msg.status === 'error'"
            class="message-action-btn"
            type="button"
            :disabled="isResponding"
            @click="$emit('retryMessage', index)"
          >
            重试
          </button>
        </div>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import MarkdownMessage from './MarkdownMessage.vue'
import type { ChatMessage } from '@/types/chat'

defineProps<{
  copiedMessageId: string | null
  isResponding: boolean
  messages: ChatMessage[]
}>()

defineEmits<{
  copyMessage: [message: ChatMessage]
  retryMessage: [index: number]
}>()

function getReasoningLabel(message: ChatMessage) {
  if (message.status === 'streaming' && !message.text) {
    return 'Thinking...'
  }

  return 'Thoughts'
}
</script>
