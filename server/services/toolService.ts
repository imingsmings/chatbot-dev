import { getWeather } from '../utils/weatherHandler.ts'
import type {
  FunctionToolDefinition,
  ToolCall,
  ToolHandler,
  ToolRegistryItem,
  ToolResult,
  WeatherToolArgs
} from '../types/tools.ts'

const WEATHER_DATE_OPTIONS = ['今天', '明天', '后天'] as const

function validateWeatherArgs(args: unknown): WeatherToolArgs {
  const value = isRecord(args) ? args : {}
  const city = typeof value.city === 'string' ? value.city.trim() : ''
  const date = typeof value.date === 'string' ? value.date.trim() : ''

  if (!city) {
    throw new Error('city 必须是非空字符串')
  }

  if (!WEATHER_DATE_OPTIONS.includes(date as (typeof WEATHER_DATE_OPTIONS)[number])) {
    throw new Error('date 只能是今天、明天或后天')
  }

  return {
    city,
    date
  }
}

const toolRegistry: ToolRegistryItem[] = [
  {
    name: 'getWeather',
    definition: {
      type: 'function',
      function: {
        name: 'getWeather',
        description: '获取指定中文城市在今天、明天或后天的天气信息。',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: '中文城市名称，例如北京、上海、成都'
            },
            date: {
              type: 'string',
              enum: WEATHER_DATE_OPTIONS,
              description: '查询日期，只能是今天、明天或后天'
            }
          },
          required: ['city', 'date'],
          additionalProperties: false
        }
      }
    },
    handler: getWeather as ToolHandler,
    validateArgs: validateWeatherArgs
  }
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

async function executeToolCalls(toolCalls: unknown, options: ExecuteToolOptions = {}): Promise<ToolResult[]> {
  const { signal, throwIfAborted } = options
  const toolResults: ToolResult[] = []

  const normalizedToolCalls = parseToolCalls(toolCalls)

  for (const tool of normalizedToolCalls) {
    throwIfAborted?.(signal)

    const functionName = tool.function
    const args = tool.args

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
      }
    } else {
      console.error(`${functionName} tool do not exist`)
      toolResults.push({
        id: tool.id,
        function: functionName,
        args,
        result: 'unknown tool'
      })
    }
  }

  return toolResults
}

export {
  executeToolCalls,
  getToolDefinitions
}
