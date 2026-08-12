import type {
  ContextPreview,
  ConversationDetail,
  ConversationImportResult,
  ConversationSearchResult,
  ConversationSummary,
  ModelRequestOptions,
  RuntimeInfo,
} from '#types/chat'

export type DownloadedFile = {
  blob: Blob
  filename: string
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as (T & { message?: string }) | null

  if (!response.ok) {
    throw new Error(data?.message || `请求失败：${response.status}`)
  }

  if (data === null) {
    throw new Error('服务端返回了无效 JSON')
  }

  return data
}

function parseContentDispositionFilename(value: string | null, fallback: string): string {
  if (!value) {
    return fallback
  }

  const encodedMatch = value.match(/filename\*=UTF-8''([^;]+)/i)
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1])
    } catch {
      return fallback
    }
  }

  const quotedMatch = value.match(/filename="([^"]+)"/i)
  if (quotedMatch?.[1]) {
    return quotedMatch[1]
  }

  const plainMatch = value.match(/filename=([^;]+)/i)
  return plainMatch?.[1]?.trim() || fallback
}

async function readDownload(response: Response, fallbackFilename: string): Promise<DownloadedFile> {
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(data?.message || `请求失败：${response.status}`)
  }

  return {
    blob: await response.blob(),
    filename: parseContentDispositionFilename(
      response.headers.get('Content-Disposition'),
      fallbackFilename,
    ),
  }
}

export async function getConversations() {
  const response = await fetch('/api/conversations')
  const data = await readJson<{ conversations: ConversationSummary[] }>(response)
  return data.conversations
}

export async function searchConversations(query: string) {
  const params = new URLSearchParams({
    q: query,
  })
  const response = await fetch(`/api/conversations/search?${params.toString()}`)
  const data = await readJson<{ conversations: ConversationSearchResult[] }>(response)
  return data.conversations
}

export async function downloadAllConversationsJson() {
  const response = await fetch('/api/conversations/export.json')
  return readDownload(response, 'chatbot-conversations.json')
}

export async function downloadConversationMarkdown(id: string) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}/export.md`)
  return readDownload(response, `${id}.md`)
}

export async function importConversationsBackup(
  backup: unknown,
  conflictStrategy: 'skip' | 'duplicate' | 'overwrite' = 'skip',
) {
  const response = await fetch('/api/conversations/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup, conflictStrategy }),
  })
  const data = await readJson<{ result: ConversationImportResult }>(response)
  return data.result
}

export async function getRuntimeConfiguration() {
  const response = await fetch('/api/runtime-config')
  const data = await readJson<{ runtime: RuntimeInfo }>(response)
  return data.runtime
}

export async function createConversation() {
  const response = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  const data = await readJson<{ conversation: ConversationDetail }>(response)
  return data.conversation
}

export async function getConversation(id: string) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`)
  const data = await readJson<{ conversation: ConversationDetail }>(response)
  return data.conversation
}

export async function updateConversationTitle(id: string, title: string) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  const data = await readJson<{ conversation: ConversationDetail }>(response)
  return data.conversation
}

export async function deleteConversation(id: string) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(data?.message || `请求失败：${response.status}`)
  }
}

export async function clearConversation(id: string) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  const data = await readJson<{ conversation: ConversationDetail }>(response)
  return data.conversation
}

export async function getConversationContextPreview(
  id: string,
  question: string,
  options: ModelRequestOptions,
) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}/context-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, options }),
  })
  const data = await readJson<{ context: ContextPreview }>(response)
  return data.context
}

export async function generateConversationSummary(id: string, options: ModelRequestOptions) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ options }),
  })
  const data = await readJson<{ conversation: ConversationDetail }>(response)
  return data.conversation
}

export async function requestConversationAnswer(params: {
  conversationId: string
  question: string
  requestId: string
  signal: AbortSignal
  options: ModelRequestOptions
}) {
  return fetch(`/api/conversations/${encodeURIComponent(params.conversationId)}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: params.question,
      requestId: params.requestId,
      options: params.options,
    }),
    signal: params.signal,
  })
}

export type RequestCancellationReason = 'manual' | 'timeout' | 'transition' | 'unmount'

export async function cancelRequest(
  requestId: string,
  reason: RequestCancellationReason = 'manual',
) {
  const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(data?.message || `请求失败：${response.status}`)
  }
}
