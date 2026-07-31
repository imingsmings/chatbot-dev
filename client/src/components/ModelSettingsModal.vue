<template>
  <div v-if="open" class="modal-overlay" @click.self="$emit('close')">
    <section class="modal-content settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="modal-header">
        <h3 id="settings-title">模型参数</h3>
        <button class="close-btn" type="button" aria-label="关闭" @click="$emit('close')">×</button>
      </header>

      <div class="modal-body settings-modal-body">
        <dl v-if="runtime" class="runtime-meta">
          <div><dt>provider</dt><dd>{{ runtime.provider }}</dd></div>
          <div><dt>model</dt><dd>{{ runtime.model || '未配置' }}</dd></div>
          <div><dt>storage</dt><dd>{{ runtime.storageBackend }}</dd></div>
        </dl>

        <label class="settings-field">
          <span>temperature</span>
          <input v-model="temperature" type="number" min="0" max="2" step="0.1" placeholder="模型默认">
        </label>

        <label class="settings-field">
          <span>max tokens</span>
          <input v-model="maxTokens" type="number" min="1" max="65536" step="1" placeholder="模型默认">
        </label>

        <label class="settings-toggle">
          <input v-model="reasoningEnabled" type="checkbox">
          <span>启用 reasoning</span>
        </label>

        <label class="settings-field">
          <span>reasoning effort</span>
          <select v-model="reasoningEffort" :disabled="!reasoningEnabled">
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="max">max</option>
          </select>
        </label>
        <p v-if="validationError" class="settings-error" role="alert">{{ validationError }}</p>
      </div>

      <footer class="modal-footer">
        <button class="modal-btn secondary" type="button" @click="$emit('close')">取消</button>
        <button class="modal-btn primary" type="button" @click="save">应用</button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ModelRequestOptions, RuntimeInfo } from '@/types/chat'
import { parseModelSettingsDraft } from '@/utils/modelOptions'

const props = defineProps<{
  open: boolean
  options: ModelRequestOptions
  runtime: RuntimeInfo | null
}>()

const emit = defineEmits<{
  close: []
  save: [options: ModelRequestOptions]
}>()

const temperature = ref('')
const maxTokens = ref('')
const reasoningEnabled = ref(true)
const reasoningEffort = ref('max')
const validationError = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    temperature.value = props.options.temperature === undefined ? '' : String(props.options.temperature)
    maxTokens.value = props.options.maxTokens === undefined ? '' : String(props.options.maxTokens)
    reasoningEnabled.value = props.options.reasoningEnabled ?? true
    reasoningEffort.value = props.options.reasoningEffort || 'max'
    validationError.value = ''
  },
  { immediate: true },
)

function save() {
  try {
    const options = parseModelSettingsDraft({
      maxTokens: maxTokens.value,
      reasoningEffort: reasoningEffort.value,
      reasoningEnabled: reasoningEnabled.value,
      temperature: temperature.value,
    })
    validationError.value = ''
    emit('save', options)
  } catch (err) {
    validationError.value = err instanceof Error ? err.message : '模型参数不合法'
  }
}
</script>
