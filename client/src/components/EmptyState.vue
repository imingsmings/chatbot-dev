<template>
  <section class="empty-state">
    <div class="empty-mark">AI</div>
    <h2>{{ title }}</h2>
    <div class="suggestion-grid">
      <button
        v-for="suggestion in suggestions"
        :key="suggestion"
        class="suggestion-card"
        type="button"
        @click="$emit('useSuggestion', suggestion)"
      >
        {{ suggestion }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  suggestions: string[]
  title: string
}>()

defineEmits<{
  useSuggestion: [suggestion: string]
}>()
</script>
