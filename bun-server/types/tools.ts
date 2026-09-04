export type ToolExecutionOptions = {
  signal?: AbortSignal
}

export type FunctionToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters?: Record<string, unknown>
    strict?: boolean
  }
}

export type ChatCompletionToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type ToolCall = {
  id?: string
  function: string
  args: unknown
}

export type ToolResult = {
  id?: string
  function: string
  args: unknown
  result: string
}

export type ToolExecutionEvent =
  | {
      type: 'tool_start'
      toolCallId?: string
      name: string
      args: unknown
    }
  | {
      type: 'tool_result'
      toolCallId?: string
      name: string
      summary: string
      success: boolean
      durationMs: number
    }

export type ToolHandler<TArgs = unknown> = (
  args: TArgs,
  options?: ToolExecutionOptions
) => Promise<string>

export type ToolRegistryItem<TArgs = unknown> = {
  name: string
  definition: FunctionToolDefinition
  handler: ToolHandler<TArgs>
  validateArgs?: (args: unknown) => TArgs
}

export type WeatherToolArgs = {
  city: string
  date: string
}

export type CurrentTimeToolArgs = {
  timeZone?: string
}

export type CalculatorToolArgs = {
  expression: string
}
