import { calculatorTool } from '../tools/calculatorTool.ts'
import { currentTimeTool } from '../tools/currentTimeTool.ts'
import { weatherTool } from '../tools/weatherTool.ts'
import type {
  FunctionToolDefinition,
  ToolCall,
  ToolExecutionEvent,
  ToolExecutionOptions,
  ToolRegistryItem,
  ToolResult
} from '../types/tools.ts'
import { MAX_STORED_TOOL_TRACE_SUMMARY_LENGTH } from '../config/productLimits.ts'

function eraseToolArgs<TArgs>(tool: ToolRegistryItem<TArgs>): ToolRegistryItem {
  return {
    name: tool.name,
    definition: tool.definition,
    handler: (args: unknown, options?: ToolExecutionOptions) =>
      tool.handler(args as TArgs, options),
    validateArgs: tool.validateArgs
  }
}

const toolRegistry: ToolRegistryItem[] = [
  eraseToolArgs(weatherTool),
  eraseToolArgs(currentTimeTool),
  eraseToolArgs(calculatorTool)
]

function validateToolRegistry(tools: ToolRegistryItem[]): void {
  const names = new Set<string>()

  for (const tool of tools) {
    const definitionName = tool.definition.function.name

    if (tool.name !== definitionName) {
      throw new Error(`工具注册名不一致：${tool.name} !== ${definitionName}`)
    }

    if (names.has(tool.name)) {
      throw new Error(`工具重复注册：${tool.name}`)
    }

    names.add(tool.name)
  }
}

validateToolRegistry(toolRegistry)

const toolsMap = new Map<string, ToolRegistryItem>(
  toolRegistry.map((tool) => [tool.name, tool])
)

type ExecuteToolOptions = {
  signal?: AbortSignal
  throwIfAborted?: (signal?: AbortSignal) => void
  onEvent?: (event: ToolExecutionEvent) => void
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
      id: typeof item.id === 'string' ? item.id : undefined,
      function: item.function,
      args: item.args
    }
  })
}

function getToolDefinitions(): FunctionToolDefinition[] {
  return toolRegistry.map((tool) => tool.definition)
}

function summarizeToolResult(result: string): string {
  const normalized = result.replace(/\s+/g, ' ').trim()
  return normalized.length > MAX_STORED_TOOL_TRACE_SUMMARY_LENGTH
    ? `${normalized.slice(0, MAX_STORED_TOOL_TRACE_SUMMARY_LENGTH - 3)}...`
    : normalized
}

async function executeToolCalls(toolCalls: unknown, options: ExecuteToolOptions = {}): Promise<ToolResult[]> {
  const { signal, throwIfAborted, onEvent } = options
  const toolResults: ToolResult[] = []

  const normalizedToolCalls = parseToolCalls(toolCalls)

  for (const tool of normalizedToolCalls) {
    throwIfAborted?.(signal)

    const functionName = tool.function
    const args = tool.args
    const startedAt = Date.now()
    onEvent?.({
      type: 'tool_start',
      toolCallId: tool.id,
      name: functionName,
      args
    })

    const toolDefinition = toolsMap.get(functionName)

    if (toolDefinition) {
      try {
        const validatedArgs = toolDefinition.validateArgs ? toolDefinition.validateArgs(args) : args
        const result = await toolDefinition.handler(validatedArgs, {
          signal
        })
        throwIfAborted?.(signal)
        toolResults.push({
          id: tool.id,
          function: functionName,
          args: validatedArgs,
          result
        })
        onEvent?.({
          type: 'tool_result',
          toolCallId: tool.id,
          name: functionName,
          summary: summarizeToolResult(result),
          success: true,
          durationMs: Math.max(0, Date.now() - startedAt)
        })
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw err
        }

        const message = err instanceof Error ? err.message : 'unknown error'
        console.error(`Failed to call tool ${functionName}`, err)
        toolResults.push({
          id: tool.id,
          function: functionName,
          args,
          result: `Failed to call tool ${message}`
        })
        onEvent?.({
          type: 'tool_result',
          toolCallId: tool.id,
          name: functionName,
          summary: `执行失败：${message}`,
          success: false,
          durationMs: Math.max(0, Date.now() - startedAt)
        })
      }
    } else {
      console.error(`${functionName} tool do not exist`)
      toolResults.push({
        id: tool.id,
        function: functionName,
        args,
        result: 'unknown tool'
      })
      onEvent?.({
        type: 'tool_result',
        toolCallId: tool.id,
        name: functionName,
        summary: '未找到该工具',
        success: false,
        durationMs: Math.max(0, Date.now() - startedAt)
      })
    }
  }

  return toolResults
}

export {
  executeToolCalls,
  getToolDefinitions
}
