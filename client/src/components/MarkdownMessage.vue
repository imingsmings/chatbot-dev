<template>
  <div class="markdown-message" v-html="html"></div>
</template>

<script setup lang="ts">
import 'highlight.js/styles/github-dark.css'
import { renderMarkdown } from '@/utils/markdownRenderer'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  content: string
  streaming?: boolean
}>()

const RENDER_THROTTLE_MS = 160

const renderedContent = ref('')
let renderTimer: number | undefined
let lastRenderedAt = 0

function clearRenderTimer() {
  if (renderTimer !== undefined) {
    window.clearTimeout(renderTimer)
    renderTimer = undefined
  }
}

function renderNow() {
  clearRenderTimer()
  renderedContent.value = props.content
  lastRenderedAt = performance.now()
}

function scheduleRender() {
  const now = performance.now()
  const elapsed = now - lastRenderedAt
  const delay = Math.max(RENDER_THROTTLE_MS - elapsed, 0)

  if (delay === 0) {
    renderNow()
    return
  }

  if (renderTimer === undefined) {
    renderTimer = window.setTimeout(() => {
      renderNow()
    }, delay)
  }
}

watch(
  () => [props.content, props.streaming] as const,
  ([, streaming]) => {
    if (streaming) {
      scheduleRender()
      return
    }

    renderNow()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearRenderTimer()
})

const html = computed(() => renderMarkdown(renderedContent.value))
</script>
