<template>
  <div v-if="open" class="modal-overlay" @click.self="$emit('close')">
    <section
      class="modal-content context-debug-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="context-debug-title"
      @keydown.esc.prevent="$emit('close')"
    >
      <header class="modal-header">
        <h3 id="context-debug-title">模型上下文</h3>
        <button class="close-btn" type="button" aria-label="关闭" @click="$emit('close')">×</button>
      </header>

      <div class="modal-body context-debug-body">
        <div v-if="context" class="context-debug-content">
          <section class="context-debug-section" aria-label="上下文统计">
            <div class="context-debug-stats">
              <div class="context-debug-stat">
                <span>历史</span>
                <strong>{{ context.stats.selectedHistoryMessages }}/{{ context.stats.totalHistoryMessages }}</strong>
              </div>
              <div class="context-debug-stat">
                <span>丢弃</span>
                <strong>{{ context.stats.droppedHistoryMessages }}</strong>
              </div>
              <div class="context-debug-stat">
                <span>字符</span>
                <strong>{{ context.stats.selectedHistoryChars }}/{{ context.stats.maxHistoryChars }}</strong>
              </div>
              <div class="context-debug-stat">
                <span>工具</span>
                <strong>{{ context.tools.count }}</strong>
              </div>
            </div>
          </section>

          <section class="context-debug-section" aria-label="模型参数">
            <h4>模型参数</h4>
            <dl class="context-debug-meta">
              <div>
                <dt>provider</dt>
                <dd>{{ context.model.provider }}</dd>
              </div>
              <div>
                <dt>model</dt>
                <dd>{{ context.model.model || '未配置' }}</dd>
              </div>
              <div>
                <dt>stream</dt>
                <dd>{{ String(context.model.stream) }}</dd>
              </div>
              <div>
                <dt>tool_choice</dt>
                <dd>{{ context.model.toolChoice }}</dd>
              </div>
              <div>
                <dt>reasoning</dt>
                <dd>{{ context.model.reasoningEnabled ? context.model.reasoningEffort : 'disabled' }}</dd>
              </div>
              <div>
                <dt>api key</dt>
                <dd>{{ context.model.apiKeyConfigured ? '已配置' : '未配置' }}</dd>
              </div>
            </dl>
          </section>

          <section class="context-debug-section" aria-label="发送给模型的 messages">
            <h4>messages</h4>
            <ol class="context-message-list">
              <li
                v-for="(message, index) in context.messages"
                :key="`${index}-${message.role}`"
                class="context-message-item"
              >
                <span class="context-message-role">{{ message.role }}</span>
                <pre class="context-message-content">{{ message.content || '' }}</pre>
              </li>
            </ol>
          </section>

          <details class="context-debug-details" open>
            <summary>tool definitions</summary>
            <pre>{{ formattedTools }}</pre>
          </details>
        </div>
      </div>

      <footer class="modal-footer">
        <button class="modal-btn secondary" type="button" @click="$emit('close')">关闭</button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ContextPreview } from '@/types/chat'

const props = defineProps<{
  context: ContextPreview | null
  open: boolean
}>()

defineEmits<{
  close: []
}>()

const formattedTools = computed(() => JSON.stringify(props.context?.tools.definitions ?? [], null, 2))
</script>
