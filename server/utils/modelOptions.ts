import type { ModelRequestOptions } from '../types/llm.ts'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled'])
const MAX_MODEL_TOKENS = 65536
const MAX_REASONING_EFFORT_LENGTH = 32

type EffectiveModelOptions = {
  temperature?: number
  maxTokens?: number
  reasoningEnabled: boolean
  reasoningEffort: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return fallback
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  const parsed = parseOptionalNumber(value)
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined
}

function readDefaultModelOptions(): EffectiveModelOptions {
  return {
    temperature: parseOptionalNumber(process.env.LLM_TEMPERATURE),
    maxTokens: parseOptionalInteger(process.env.LLM_MAX_TOKENS),
    reasoningEnabled: parseBoolean(process.env.LLM_REASONING_ENABLED, true),
    reasoningEffort: process.env.LLM_REASONING_EFFORT?.trim() || 'max'
  }
}

function parseModelRequestOptions(value: unknown): ModelRequestOptions {
  if (value === undefined || value === null) {
    return {}
  }

  if (!isRecord(value)) {
    throw new Error('模型参数必须是对象')
  }

  const options: ModelRequestOptions = {}

  if (value.temperature !== undefined && value.temperature !== null) {
    if (
      typeof value.temperature !== 'number' ||
      !Number.isFinite(value.temperature) ||
      value.temperature < 0 ||
      value.temperature > 2
    ) {
      throw new Error('temperature 必须是 0 到 2 之间的数字')
    }
    options.temperature = value.temperature
  }

  if (value.maxTokens !== undefined && value.maxTokens !== null) {
    if (
      typeof value.maxTokens !== 'number' ||
      !Number.isInteger(value.maxTokens) ||
      value.maxTokens < 1 ||
      value.maxTokens > MAX_MODEL_TOKENS
    ) {
      throw new Error(`maxTokens 必须是 1 到 ${MAX_MODEL_TOKENS} 之间的整数`)
    }
    options.maxTokens = value.maxTokens
  }

  if (value.reasoningEnabled !== undefined) {
    if (typeof value.reasoningEnabled !== 'boolean') {
      throw new Error('reasoningEnabled 必须是布尔值')
    }
    options.reasoningEnabled = value.reasoningEnabled
  }

  if (value.reasoningEffort !== undefined && value.reasoningEffort !== null) {
    if (
      typeof value.reasoningEffort !== 'string' ||
      !value.reasoningEffort.trim() ||
      value.reasoningEffort.trim().length > MAX_REASONING_EFFORT_LENGTH ||
      !/^[a-z0-9_-]+$/i.test(value.reasoningEffort.trim())
    ) {
      throw new Error('reasoningEffort 必须是长度不超过 32 的字母、数字、下划线或连字符')
    }
    options.reasoningEffort = value.reasoningEffort.trim()
  }

  return options
}

function resolveModelOptions(overrides: ModelRequestOptions = {}): EffectiveModelOptions {
  const defaults = readDefaultModelOptions()

  return {
    temperature: overrides.temperature ?? defaults.temperature,
    maxTokens: overrides.maxTokens ?? defaults.maxTokens,
    reasoningEnabled: overrides.reasoningEnabled ?? defaults.reasoningEnabled,
    reasoningEffort: overrides.reasoningEffort ?? defaults.reasoningEffort
  }
}

export {
  type EffectiveModelOptions,
  MAX_MODEL_TOKENS,
  parseModelRequestOptions,
  readDefaultModelOptions,
  resolveModelOptions
}
