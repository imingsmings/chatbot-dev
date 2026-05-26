<template>
  <form class="composer" @submit.prevent="$emit('submit')">
    <div class="composer-inner">
      <textarea
        ref="composerInput"
        :value="modelValue"
        rows="1"
        placeholder="询问任何问题"
        :disabled="disabled"
        @input="handleInput"
        @keydown.enter.exact.prevent="$emit('submit')"
      ></textarea>
      <button
        class="context-preview-btn"
        type="button"
        :disabled="!canPreviewContext || isContextPreviewLoading"
        @click="$emit('previewContext')"
      >
        {{ isContextPreviewLoading ? '加载中' : '上下文' }}
      </button>
      <button
        v-if="isResponding"
        class="send-btn stop-btn"
        type="button"
        aria-label="停止生成"
        @click="$emit('stop')"
      >
        停止
      </button>
      <button v-else class="send-btn" type="submit" :disabled="!canSubmit" aria-label="发送消息">
        发送
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  canSubmit: boolean
  canPreviewContext: boolean
  disabled: boolean
  isContextPreviewLoading: boolean
  isResponding: boolean
  modelValue: string
}>()

const emit = defineEmits<{
  stop: []
  submit: []
  previewContext: []
  'update:modelValue': [value: string]
}>()

const composerInput = ref<HTMLTextAreaElement | null>(null)

function resizeComposer() {
  const element = composerInput.value

  if (!element) {
    return
  }

  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`
}

function focus() {
  composerInput.value?.focus()
}

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  resizeComposer()
}

defineExpose({
  focus,
  resizeComposer,
})
</script>
