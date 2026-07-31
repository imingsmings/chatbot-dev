<template>
  <div v-if="open" class="modal-overlay" @click.self="$emit('close')">
    <section class="modal-content summary-modal" role="dialog" aria-modal="true" aria-labelledby="summary-title">
      <header class="modal-header">
        <h3 id="summary-title">会话摘要</h3>
        <button class="close-btn" type="button" aria-label="关闭" @click="$emit('close')">×</button>
      </header>

      <div class="modal-body summary-modal-body">
        <template v-if="summary">
          <p class="summary-meta">
            基于 {{ summary.sourceMessageCount }} 条消息 · {{ formatTime(summary.updatedAt) }}
          </p>
          <div class="summary-content">{{ summary.content }}</div>
        </template>
        <p v-else class="summary-empty">当前会话还没有摘要</p>
      </div>

      <footer class="modal-footer">
        <button class="modal-btn secondary" type="button" @click="$emit('close')">关闭</button>
        <button class="modal-btn primary" type="button" :disabled="loading" @click="$emit('generate')">
          {{ loading ? '生成中...' : summary ? '重新生成' : '生成摘要' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { ConversationContextSummary } from '@/types/chat'

defineProps<{
  loading: boolean
  open: boolean
  summary?: ConversationContextSummary
}>()

defineEmits<{
  close: []
  generate: []
}>()

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
</script>
