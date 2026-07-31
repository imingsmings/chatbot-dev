<template>
  <div
    ref="root"
    class="markdown-message"
    :data-render-mode="streaming ? 'streaming-lite' : 'complete'"
    v-html="html"
    @click="handleClick"
  ></div>
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
const root = ref<HTMLElement | null>(null)
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
  const throttle =
    props.content.length > 40000 ? 420 : props.content.length > 12000 ? 260 : RENDER_THROTTLE_MS
  const delay = Math.max(throttle - elapsed, 0)

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

async function handleClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const button = target.closest<HTMLButtonElement>('[data-code-copy]')
  if (!button) return

  const code = button.closest('.code-block')?.querySelector('code')?.textContent
  if (code == null) return

  try {
    await navigator.clipboard.writeText(code)
    const originalText = button.textContent || '复制'
    button.textContent = '已复制'
    window.setTimeout(() => {
      if (button.isConnected) {
        button.textContent = originalText
      }
    }, 1400)
  } catch {
    button.textContent = '复制失败'
  }
}

const html = computed(() =>
  renderMarkdown(renderedContent.value, {
    highlightCode: !props.streaming,
  }),
)
</script>
