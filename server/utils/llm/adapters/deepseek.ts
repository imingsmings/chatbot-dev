import type { LlmAdapter, LlmStreamEvent } from '../../../types/llm.ts'
import type { PromptMessage } from '../../../types/conversation.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getChoice(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data) || !Array.isArray(data.choices)) {
    return null
  }

  const [choice] = data.choices
  return isRecord(choice) ? choice : null
}

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
  }
}

function buildBody({
  model,
  prompt,
  stream
}: {
  model: string | undefined
  prompt: PromptMessage[]
  stream: boolean
}): unknown {
  return {
    model,
    messages: prompt,
    stream
  }
}

function parseResponse(data: unknown): string {
  const choice = getChoice(data)
  const message = choice?.message

  if (!isRecord(message)) {
    return ''
  }

  return typeof message.content === 'string' ? message.content : ''
}

function parseStreamLine(line: string): LlmStreamEvent | null {
  const text = line.trim()
  if (!text) return null
  if (!text.startsWith('data: ')) return null

  const jsonStr = text.slice(6)
  if (jsonStr === '[DONE]') {
    return { done: true }
  }

  const data = JSON.parse(jsonStr) as unknown
  const choice = getChoice(data)
  const delta = choice?.delta

  if (!isRecord(delta)) {
    return null
  }

  const content = delta.content

  return typeof content === 'string' && content ? { content } : null
}

const deepseekAdapter: LlmAdapter = {
  name: 'deepseek',
  buildHeaders,
  buildBody,
  parseResponse,
  parseStreamLine
}

export default deepseekAdapter
