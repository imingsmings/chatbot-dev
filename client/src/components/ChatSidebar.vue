<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div>
        <p class="sidebar-eyebrow">Chatbot</p>
        <h1>AI 助手</h1>
      </div>
      <div class="sidebar-header-actions">
        <button class="theme-toggle-btn" type="button" @click="$emit('toggleTheme')">
          {{ themeToggleLabel }}
        </button>
        <button class="new-chat-btn" type="button" @click="$emit('newChat')">新建</button>
      </div>
    </div>

    <div class="conversation-search">
      <input
        class="conversation-search-input"
        type="search"
        placeholder="搜索会话"
        :value="searchQuery"
        @input="$emit('updateSearchQuery', ($event.target as HTMLInputElement).value)"
      >
      <p v-if="searchError" class="conversation-search-status error">{{ searchError }}</p>
      <p v-else-if="isSearching" class="conversation-search-status">搜索中...</p>
    </div>

    <nav class="conversation-panel" aria-label="会话">
      <p class="section-label">会话</p>
      <div v-if="conversations.length === 0" class="empty-sidebar-state">
        {{ searchQuery.trim() ? '无匹配会话' : '暂无会话' }}
      </div>
      <div
        v-for="conversation in conversations"
        :key="conversation.id"
        :class="[
          'conversation-item-shell',
          { active: conversation.id === currentConversationId },
        ]"
      >
        <button
          class="conversation-item"
          type="button"
          @click="$emit('selectConversation', conversation.id)"
        >
          <span class="conversation-title">{{ conversation.title }}</span>
          <span class="conversation-meta">{{ conversation.messageCount }} 条消息</span>
          <span v-if="'matchedIn' in conversation" class="conversation-match">
            {{ getMatchLabel(conversation.matchedIn) }}
          </span>
          <span v-if="'snippet' in conversation && conversation.snippet" class="conversation-snippet">
            {{ conversation.snippet }}
          </span>
        </button>
        <div class="conversation-actions">
          <button
            class="conversation-action-btn"
            type="button"
            title="重命名"
            @click="$emit('renameConversation', conversation)"
          >
            重命名
          </button>
          <button
            class="conversation-action-btn danger"
            type="button"
            title="删除"
            @click="$emit('deleteConversation', conversation.id)"
          >
            删除
          </button>
        </div>
      </div>
    </nav>

    <div class="sidebar-footer">
      <button
        class="clear-history-btn"
        type="button"
        :disabled="!currentConversationId || isResponding"
        @click="$emit('clearConversation')"
      >
        清空当前会话
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type {
  ConversationSearchMatchLocation,
  ConversationSearchResult,
  ConversationSummary,
} from '@/types/chat'

type SidebarConversation = ConversationSummary | ConversationSearchResult

defineProps<{
  conversations: SidebarConversation[]
  currentConversationId: string | null
  isSearching: boolean
  isResponding: boolean
  searchError: string
  searchQuery: string
  themeToggleLabel: string
}>()

defineEmits<{
  clearConversation: []
  deleteConversation: [id: string]
  newChat: []
  renameConversation: [conversation: ConversationSummary]
  selectConversation: [id: string]
  toggleTheme: []
  updateSearchQuery: [query: string]
}>()

function getMatchLabel(location: ConversationSearchMatchLocation): string {
  return location === 'title' ? '标题匹配' : '消息匹配'
}
</script>
