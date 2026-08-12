export type MessageStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

export type ThemeMode = 'light' | 'dark'

export type DeepSeekModelId = 'deepseek-v4-flash' | 'deepseek-v4-pro'

export type LlmProviderId = 'deepseek' | 'openai'

export type ModelCapabilities = {
  tools: boolean
  reasoning: boolean
  reasoningSummary: boolean
  reasoningEfforts: string[]
  temperature: boolean
  maxOutputTokens: number
}

export type ModelDescriptor = {
  provider: LlmProviderId
  id: string
  label: string
  disabled?: boolean
  capabilities: ModelCapabilities
}

export type RuntimeProvider = {
  id: LlmProviderId
  label: string
  models: ModelDescriptor[]
  configured: boolean
  endpointConfigured: boolean
  apiKeyConfigured: boolean
  defaultModel: string
}

export type ModelRequestOptions = {
  provider?: LlmProviderId
  model?: string
  temperature?: number
  maxTokens?: number
  reasoningEnabled?: boolean
  reasoningEffort?: string
}

export type ToolActivity = {
  id: string
  name: string
  status: 'running' | 'success' | 'error' | 'stopped'
  summary?: string
  durationMs?: number
}

export type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

export type GenerationMetadata = {
  provider: LlmProviderId
  model: string
  finishReason?: string
  firstTokenLatencyMs?: number
  totalDurationMs: number
  usage?: TokenUsage
}

export type StoredToolTrace = {
  name: string
  success: boolean
  durationMs: number
  summary: string
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  reasoningText?: string
  reasoningDurationMs?: number
  status: MessageStatus
  error?: string
  toolActivities?: ToolActivity[]
  generation?: GenerationMetadata
}

export type StoredMessage = {
  role: 'user' | 'assistant'
  content: string
  reasoningContent?: string
  reasoningDurationMs?: number
  status?: 'completed' | 'stopped'
  generation?: GenerationMetadata
  toolTrace?: StoredToolTrace[]
}

export type ConversationSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export type ConversationContextSummary = {
  content: string
  sourceMessageCount: number
  updatedAt: string
}

export type ConversationSearchMatchLocation = 'title' | 'message'

export type ConversationSearchResult = ConversationSummary & {
  matchedIn: ConversationSearchMatchLocation
  snippet?: string
}

export type ConversationDetail = ConversationSummary & {
  titleManuallyEdited?: boolean
  messages: StoredMessage[]
  summary?: ConversationContextSummary
}

export type PromptMessageRole = StoredMessage['role'] | 'system' | 'tool'

export type ContextPreviewMessage = {
  role: PromptMessageRole
  content: string | null
  reasoning_content?: string
  tool_call_id?: string
  tool_calls?: unknown[]
}

export type ContextPreview = {
  conversationId: string
  question: string
  messages: ContextPreviewMessage[]
  stats: {
    totalHistoryMessages: number
    summaryCoveredMessages: number
    postSummaryMessages: number
    excludedStoppedMessages: number
    selectedHistoryMessages: number
    droppedHistoryMessages: number
    selectedHistoryChars: number
    selectedHistoryRange: {
      start: number
      end: number
    } | null
    maxHistoryMessages: number
    maxHistoryChars: number
    summaryIncluded: boolean
  }
  model: {
    provider: string
    model: string | null
    endpointConfigured: boolean
    apiKeyConfigured: boolean
    reasoningEnabled: boolean
    reasoningEffort: string
    stream: true
    toolChoice: 'auto'
    storageBackend: 'file' | 'sqlite'
    temperature: number | null
    maxTokens: number | null
  }
  tools: {
    count: number
    definitions: unknown[]
  }
}

export type RuntimeInfo = {
  profile?: {
    name: string
    avatarUrl: string
  }
  provider: LlmProviderId
  model: string | null
  storageBackend: 'file' | 'sqlite'
  endpointConfigured: boolean
  apiKeyConfigured: boolean
  providers?: RuntimeProvider[]
  defaults: {
    temperature: number | null
    maxTokens: number | null
    reasoningEnabled: boolean
    reasoningEffort: string
  }
}

export type ConversationImportResult = {
  total: number
  created: number
  duplicated: number
  overwritten: number
  skipped: number
  items: Array<{
    sourceId: string
    conversationId: string | null
    status: 'created' | 'duplicated' | 'overwritten' | 'skipped'
  }>
}

export type SidebarOperation = {
  type:
    | 'initialize'
    | 'create'
    | 'select'
    | 'rename'
    | 'delete'
    | 'clear'
    | 'branch'
    | 'export-one'
    | 'export-all'
    | 'import'
  conversationId?: string
}
