<template>
  <div
    v-if="open"
    class="modal-overlay"
    @click.self="handleCancel"
  >
    <section
      ref="dialogRef"
      class="modal-content app-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="messageId"
      @keydown="handleKeydown"
    >
      <header class="modal-header">
        <h3 :id="titleId">{{ title }}</h3>
        <button class="close-btn" type="button" aria-label="关闭" @click="handleCancel">×</button>
      </header>

      <div class="modal-body">
        <p :id="messageId" class="dialog-message">{{ message }}</p>
        <label v-if="mode === 'prompt'" class="dialog-field">
          <span class="dialog-label">会话名称</span>
          <input
            ref="inputRef"
            v-model="draftValue"
            class="dialog-input"
            type="text"
            @keydown.enter.prevent="handleConfirm"
          >
        </label>
      </div>

      <footer class="modal-footer">
        <button
          v-if="mode !== 'alert'"
          class="modal-btn secondary"
          type="button"
          @click="handleCancel"
        >
          {{ cancelLabel }}
        </button>
        <button
          ref="confirmButtonRef"
          :class="['modal-btn', { danger }]"
          type="button"
          @click="handleConfirm"
        >
          {{ confirmLabel }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

type DialogMode = 'alert' | 'confirm' | 'prompt'

const props = withDefaults(defineProps<{
  cancelLabel?: string
  confirmLabel?: string
  danger?: boolean
  initialValue?: string
  message: string
  mode: DialogMode
  open: boolean
  title: string
}>(), {
  cancelLabel: '取消',
  confirmLabel: '确定',
  danger: false,
  initialValue: '',
})

const emit = defineEmits<{
  cancel: []
  confirm: [value: string | true]
}>()

const dialogRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const confirmButtonRef = ref<HTMLButtonElement | null>(null)
const draftValue = ref('')
const idSuffix = Math.random().toString(36).slice(2)
const titleId = `dialog-title-${idSuffix}`
const messageId = `dialog-message-${idSuffix}`

watch(
  () => props.open,
  async (open) => {
    if (!open) return

    draftValue.value = props.initialValue
    await nextTick()

    if (props.mode === 'prompt') {
      inputRef.value?.focus()
      inputRef.value?.select()
      return
    }

    confirmButtonRef.value?.focus()
  },
)

function handleCancel() {
  emit('cancel')
}

function handleConfirm() {
  emit('confirm', props.mode === 'prompt' ? draftValue.value : true)
}

function getFocusableElements(): HTMLElement[] {
  if (!dialogRef.value) {
    return []
  }

  return [...dialogRef.value.querySelectorAll<HTMLElement>(
    'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    handleCancel()
    return
  }

  if (event.key !== 'Tab') {
    return
  }

  const focusableElements = getFocusableElements()
  if (focusableElements.length === 0) {
    return
  }

  const firstElement = focusableElements[0]
  const lastElement = focusableElements[focusableElements.length - 1]

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault()
    lastElement?.focus()
    return
  }

  if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault()
    firstElement.focus()
  }
}
</script>
