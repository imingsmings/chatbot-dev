import type { ConversationDetail, ConversationSummary } from '@/types/chat'

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function getConversations() {
  const response = await fetch('/api/conversations')
  const data = await readJson<{ conversations: ConversationSummary[] }>(response)
  return data.conversations
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
    throw new Error(`请求失败：${response.status}`)
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

export async function requestConversationAnswer(params: {
  conversationId: string
  question: string
  requestId: string
  signal: AbortSignal
}) {
  return fetch(`/api/conversations/${encodeURIComponent(params.conversationId)}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: params.question,
      requestId: params.requestId,
    }),
    signal: params.signal,
  })
}

export async function cancelRequest(requestId: string) {
  const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`)
  }
}
