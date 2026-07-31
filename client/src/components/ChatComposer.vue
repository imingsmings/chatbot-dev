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
      <div class="composer-tools">
        <button class="composer-tool-btn" type="button" :disabled="disabled" @click="$emit('openTemplates')">
          模板
        </button>
        <button class="composer-tool-btn" type="button" :disabled="disabled" @click="$emit('openSettings')">
          参数
        </button>
        <button class="composer-tool-btn" type="button" :disabled="disabled" @click="$emit('openSummary')">
          摘要
        </button>
        <button
          class="composer-tool-btn"
          type="button"
          :disabled="!canPreviewContext || isContextPreviewLoading"
          @click="$emit('previewContext')"
        >
          {{ isContextPreviewLoading ? '加载中' : '上下文' }}
        </button>
      </div>
      <button
        v-if="isResponding || isStopping"
        :class="['send-btn', 'stop-btn', { stopping: isStopping }]"
        type="button"
        :aria-busy="isStopping"
        :aria-label="isStopping ? '正在停止生成' : '停止生成'"
        :disabled="isStopping"
        @click="$emit('stop')"
      >
        {{ isStopping ? '停止中...' : '停止' }}
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
  isStopping: boolean
  modelValue: string
}>()

const emit = defineEmits<{
  stop: []
  submit: []
  previewContext: []
  openSettings: []
  openSummary: []
  openTemplates: []
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
