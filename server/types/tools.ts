export type ToolExecutionOptions = {
  signal?: AbortSignal
}

export type ToolCall = {
  function: string
  args: unknown
}

export type ToolResult = {
  function: string
  args: unknown
  result: string
}

export type ToolHandler<TArgs = unknown> = (
  args: TArgs,
  options?: ToolExecutionOptions
) => Promise<string>

export type WeatherToolArgs = {
  city: string
  date: string
}
