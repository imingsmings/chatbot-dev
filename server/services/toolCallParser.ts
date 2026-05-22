import type { ToolCall } from '../types/tools.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenceMatch?.[1]?.trim() ?? trimmed
}

function normalizeToolCall(item: unknown, index: number): ToolCall {
  if (!isRecord(item)) {
    throw new Error(`工具调用第 ${index + 1} 项必须是对象`)
  }

  if (typeof item.function !== 'string' || !item.function.trim()) {
    throw new Error(`工具调用第 ${index + 1} 项缺少有效的 function`)
  }

  if (!Object.hasOwn(item, 'args') || !isRecord(item.args)) {
    throw new Error(`工具调用第 ${index + 1} 项缺少有效的 args`)
  }

  return {
    function: item.function.trim(),
    args: item.args
  }
}

function parseToolCallsFromText(text: string): ToolCall[] {
  const normalizedText = stripCodeFence(text)

  if (!normalizedText || normalizedText === '无函数调用') {
    return []
  }

  try {
    const parsed = JSON.parse(normalizedText) as unknown

    if (!Array.isArray(parsed)) {
      console.warn('Tool call decision is not a JSON array:', normalizedText)
      return []
    }

    return parsed.map(normalizeToolCall)
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn('Failed to parse tool call decision:', err)
      return []
    }

    throw err
  }
}

export {
  parseToolCallsFromText
}
