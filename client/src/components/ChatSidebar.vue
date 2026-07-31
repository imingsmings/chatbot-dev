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
        <button
          class="new-chat-btn"
          type="button"
          :aria-busy="isOperation('create')"
          :disabled="sidebarBusy || isStopping"
          @click="$emit('newChat')"
        >
          {{ isOperation('create') ? '新建中...' : '新建' }}
        </button>
      </div>
    </div>

    <div class="conversation-search">
      <input
        class="conversation-search-input"
        type="search"
        placeholder="搜索会话"
        :disabled="sidebarBusy || isStopping"
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
          :aria-busy="isOperation('select', conversation.id)"
          :disabled="sidebarBusy || isStopping"
          @click="$emit('selectConversation', conversation.id)"
        >
          <span class="conversation-title">{{ conversation.title }}</span>
          <span class="conversation-meta">
            {{
              isOperation('select', conversation.id)
                ? '加载中...'
                : `${conversation.messageCount} 条消息`
            }}
          </span>
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
            title="导出 Markdown"
            :aria-busy="isOperation('export-one', conversation.id)"
            :disabled="sidebarBusy || isResponding || isStopping"
            @click="$emit('exportConversation', conversation)"
          >
            {{ isOperation('export-one', conversation.id) ? '导出中...' : '导出' }}
          </button>
          <button
            class="conversation-action-btn"
            type="button"
            title="重命名"
            :aria-busy="isOperation('rename', conversation.id)"
            :disabled="sidebarBusy || isStopping"
            @click="$emit('renameConversation', conversation)"
          >
            {{ isOperation('rename', conversation.id) ? '保存中...' : '重命名' }}
          </button>
          <button
            class="conversation-action-btn danger"
            type="button"
            title="删除"
            :aria-busy="isOperation('delete', conversation.id)"
            :disabled="sidebarBusy || isResponding || isStopping"
            @click="$emit('deleteConversation', conversation.id)"
          >
            {{ isOperation('delete', conversation.id) ? '删除中...' : '删除' }}
          </button>
        </div>
      </div>
    </nav>

    <div class="sidebar-footer">
      <button
        class="export-all-btn"
        type="button"
        :aria-busy="isOperation('import')"
        :disabled="sidebarBusy || isResponding || isStopping"
        @click="$emit('importConversations')"
      >
        {{ isOperation('import') ? '导入中...' : '导入 JSON' }}
      </button>
      <button
        class="export-all-btn"
        type="button"
        :aria-busy="isOperation('export-all')"
        :disabled="sidebarBusy || isResponding || isStopping"
        @click="$emit('exportAllConversations')"
      >
        {{ isOperation('export-all') ? '导出中...' : '导出全部 JSON' }}
      </button>
      <button
        class="clear-history-btn"
        type="button"
        :aria-busy="isOperation('clear')"
        :disabled="!currentConversationId || isResponding || isStopping || sidebarBusy"
        @click="$emit('clearConversation')"
      >
        {{ isOperation('clear') ? '清空中...' : '清空当前会话' }}
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  ConversationSearchMatchLocation,
  ConversationSearchResult,
  ConversationSummary,
  SidebarOperation,
} from '@/types/chat'

type SidebarConversation = ConversationSummary | ConversationSearchResult

const props = defineProps<{
  conversations: SidebarConversation[]
  currentConversationId: string | null
  isSearching: boolean
  isResponding: boolean
  isStopping: boolean
  operation: SidebarOperation | null
  searchError: string
  searchQuery: string
  themeToggleLabel: string
}>()

const sidebarBusy = computed(() => Boolean(props.operation))

function isOperation(type: SidebarOperation['type'], conversationId?: string): boolean {
  return (
    props.operation?.type === type &&
    (!conversationId || props.operation.conversationId === conversationId)
  )
}

defineEmits<{
  clearConversation: []
  deleteConversation: [id: string]
  exportAllConversations: []
  exportConversation: [conversation: ConversationSummary]
  importConversations: []
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
