import { getWeather } from '../utils/weatherHandler.ts'
import type { ToolCall, ToolHandler, ToolResult } from '../types/tools.ts'

const toolsMap: Record<string, ToolHandler> = {
  getWeather
}

type ExecuteToolOptions = {
  signal?: AbortSignal
  throwIfAborted?: (signal?: AbortSignal) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) {
    throw new Error('工具调用结果必须是 JSON 数组')
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`工具调用第 ${index + 1} 项必须是对象`)
    }

    if (typeof item.function !== 'string' || !item.function.trim()) {
      throw new Error(`工具调用第 ${index + 1} 项缺少有效的 function`)
    }

    if (!Object.hasOwn(item, 'args')) {
      throw new Error(`工具调用第 ${index + 1} 项缺少 args`)
    }

    return {
      function: item.function,
      args: item.args
    }
  })
}

async function executeToolCalls(toolCalls: unknown, options: ExecuteToolOptions = {}): Promise<ToolResult[]> {
  const { signal, throwIfAborted } = options
  const toolResults: ToolResult[] = []

  const normalizedToolCalls = parseToolCalls(toolCalls)

  for (const tool of normalizedToolCalls) {
    throwIfAborted?.(signal)

    const functionName = tool.function
    const args = tool.args

    if (toolsMap[functionName]) {
      try {
        const result = await toolsMap[functionName](args, {
          signal
        })
        throwIfAborted?.(signal)
        toolResults.push({
          function: functionName,
          args,
          result
        })
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw err
        }

        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`Failed to call tool ${functionName}`, err)
        toolResults.push({
          function: functionName,
          args,
          result: `Failed to call tool ${message}`
        })
      }
    } else {
      console.error(`${functionName} tool do not exist`)
      toolResults.push({
        function: functionName,
        args,
        result: 'unknown tool'
      })
    }
  }

  return toolResults
}

export {
  executeToolCalls
}
