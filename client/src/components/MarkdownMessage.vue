<template>
  <div class="markdown-message" v-html="html"></div>
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdownLanguage from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import 'highlight.js/styles/github-dark.css'
import MarkdownIt from 'markdown-it'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  content: string
  streaming?: boolean
}>()

const RENDER_THROTTLE_MS = 160

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('css', css)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdownLanguage)
hljs.registerLanguage('python', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  highlight(code, language) {
    const normalizedLanguage = language?.trim()

    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return hljs.highlight(code, {
        language: normalizedLanguage,
        ignoreIllegals: true,
      }).value
    }

    return hljs.highlightAuto(code).value
  },
  linkify: true,
  typographer: true,
})

markdown.disable('image')

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

const html = computed(() =>
  DOMPurify.sanitize(markdown.render(renderedContent.value), {
    FORBID_TAGS: ['img'],
  }),
)
</script>
