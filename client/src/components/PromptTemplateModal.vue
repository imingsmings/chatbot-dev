<template>
  <div v-if="open" class="modal-overlay" @click.self="$emit('close')">
    <section class="modal-content template-modal" role="dialog" aria-modal="true" aria-labelledby="template-title">
      <header class="modal-header">
        <h3 id="template-title">Prompt 模板</h3>
        <button class="close-btn" type="button" aria-label="关闭" @click="$emit('close')">×</button>
      </header>

      <div class="modal-body template-modal-body">
        <nav class="template-list" aria-label="Prompt 模板列表">
          <button
            v-for="template in promptTemplates"
            :key="template.id"
            :class="['template-list-item', { active: template.id === selectedTemplate.id }]"
            type="button"
            @click="selectTemplate(template)"
          >
            {{ template.name }}
          </button>
        </nav>

        <form class="template-fields" @submit.prevent="applyTemplate">
          <h4>{{ selectedTemplate.name }}</h4>
          <label
            v-for="variable in selectedTemplate.variables"
            :key="variable.name"
            class="settings-field"
          >
            <span>{{ variable.label }}</span>
            <textarea
              v-if="variable.multiline"
              v-model="values[variable.name]"
              :placeholder="variable.placeholder"
              rows="6"
            ></textarea>
            <input
              v-else
              v-model="values[variable.name]"
              :placeholder="variable.placeholder"
              type="text"
            >
          </label>
        </form>
      </div>

      <footer class="modal-footer">
        <button class="modal-btn secondary" type="button" @click="$emit('close')">取消</button>
        <button class="modal-btn primary" type="button" @click="applyTemplate">填入输入框</button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  promptTemplates,
  renderPromptTemplate,
  type PromptTemplate,
} from '@/utils/promptTemplates'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  apply: [prompt: string]
  close: []
}>()

const selectedTemplate = ref(promptTemplates[0])
const values = reactive<Record<string, string>>({})

function resetValues(template: PromptTemplate) {
  for (const key of Object.keys(values)) {
    delete values[key]
  }
  for (const variable of template.variables) {
    values[variable.name] = ''
  }
}

function selectTemplate(template: PromptTemplate) {
  selectedTemplate.value = template
  resetValues(template)
}

function applyTemplate() {
  emit('apply', renderPromptTemplate(selectedTemplate.value, values))
}

resetValues(selectedTemplate.value)
</script>
