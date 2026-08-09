import { MAX_MODEL_TOKENS, resolveModelOptions } from './modelOptions.ts'
import { findModelDescriptor, readDisabledModelIds } from './llm/modelCatalog.ts'
import { getProviderConfig, readDefaultProvider } from './llm/providerConfig.ts'
import { readConversationStoreKind } from '../config/conversationStoreConfig.ts'

type ValidationIssue = {
  name: string
  reason: string
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled'])

function isMissingConfigValue(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  return !trimmed || trimmed.startsWith('replace_with_')
}

function requireConfigValue(name: string, issues: ValidationIssue[]): void {
  if (isMissingConfigValue(process.env[name])) {
    issues.push({
      name,
      reason: '未配置或仍是示例占位值'
    })
  }
}

function validateBooleanEnv(name: string, issues: ValidationIssue[]): void {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    return
  }

  const normalized = value.trim().toLowerCase()
  if (!TRUE_VALUES.has(normalized) && !FALSE_VALUES.has(normalized)) {
    issues.push({
      name,
      reason: '必须是布尔值，例如 true/false、1/0、yes/no、on/off'
    })
  }
}

function validatePositiveIntegerEnv(
  name: string,
  issues: ValidationIssue[],
  maximum = Number.MAX_SAFE_INTEGER
): void {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    return
  }

  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue <= 0 || numberValue > maximum) {
    issues.push({
      name,
      reason: maximum === Number.MAX_SAFE_INTEGER
        ? '必须是正整数'
        : `必须是 1 到 ${maximum} 之间的整数`
    })
  }
}

function validateNumberRangeEnv(
  name: string,
  minimum: number,
  maximum: number,
  issues: ValidationIssue[]
): void {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    return
  }

  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < minimum || numberValue > maximum) {
    issues.push({
      name,
      reason: `必须是 ${minimum} 到 ${maximum} 之间的数字`
    })
  }
}

function formatConfigError(title: string, issues: ValidationIssue[]): Error {
  return new Error(`${title}：${issues.map((item) => `${item.name} ${item.reason}`).join('；')}`)
}

function validateStartupConfig(): void {
  const issues: ValidationIssue[] = []
  let providerConfig
  let providerId

  try {
    providerId = readDefaultProvider()
  } catch (error) {
    issues.push({
      name: 'LLM_PROVIDER',
      reason: error instanceof Error ? error.message : '配置不合法'
    })
  }

  if (providerId) {
    try {
      providerConfig = getProviderConfig(providerId)
    } catch (error) {
      issues.push({
        name: providerId === 'openai' ? 'OPENAI_ENDPOINT' : 'LLM_ENDPOINT/DEEPSEEK_ENDPOINT',
        reason: error instanceof Error ? error.message : '配置不合法'
      })
    }
  }

  if (providerConfig) {
    if (!providerConfig.endpoint) {
      issues.push({
        name: providerConfig.id === 'openai' ? 'OPENAI_ENDPOINT' : 'LLM_ENDPOINT/DEEPSEEK_ENDPOINT',
        reason: '未配置或仍是示例占位值'
      })
    }
    if (!providerConfig.apiKey) {
      issues.push({
        name: providerConfig.id === 'openai' ? 'OPENAI_API_KEY' : 'DEEPSEEK_API_KEY',
        reason: '未配置或仍是示例占位值'
      })
    }
  }

  try {
    readConversationStoreKind()
  } catch (error) {
    issues.push({
      name: 'CONVERSATION_STORE',
      reason: error instanceof Error ? error.message : '配置不合法'
    })
  }

  validatePositiveIntegerEnv('LLM_TIMEOUT_MS', issues)
  validatePositiveIntegerEnv('LLM_MAX_TOKENS', issues, MAX_MODEL_TOKENS)
  validateNumberRangeEnv('LLM_TEMPERATURE', 0, 2, issues)
  validateBooleanEnv('LLM_REASONING_ENABLED', issues)

  const unknownDisabledModels = [...readDisabledModelIds()]
    .filter((modelId) => !findModelDescriptor(modelId))
  if (unknownDisabledModels.length > 0) {
    issues.push({
      name: 'LLM_DISABLED_MODELS',
      reason: `包含未知模型：${unknownDisabledModels.join('、')}`
    })
  }

  try {
    resolveModelOptions()
  } catch (error) {
    issues.push({
      name: 'LLM_MODEL_OPTIONS',
      reason: error instanceof Error ? error.message : '配置不合法'
    })
  }

  if (issues.length > 0) {
    throw formatConfigError('后端启动配置错误', issues)
  }
}

function validateWeatherConfig(): void {
  const issues: ValidationIssue[] = []

  requireConfigValue('HEFENG_API_HOST', issues)
  requireConfigValue('HEFENG_API_KEY', issues)

  const host = process.env.HEFENG_API_HOST?.trim()
  if (host && !host.startsWith('replace_with_')) {
    try {
      const url = new URL(`https://${host}`)
      if (url.hostname !== host || url.pathname !== '/' || url.search || url.hash) {
        throw new Error()
      }
    } catch {
      issues.push({
        name: 'HEFENG_API_HOST',
        reason: '必须是纯主机名，不包含协议、路径、查询或片段'
      })
    }
  }

  if (issues.length > 0) {
    throw formatConfigError('天气工具配置错误', issues)
  }
}

function getWeatherConfig(): {
  host: string
  headers: Record<string, string>
} {
  validateWeatherConfig()

  return {
    host: process.env.HEFENG_API_HOST?.trim() ?? '',
    headers: {
      'X-QW-Api-Key': process.env.HEFENG_API_KEY?.trim() ?? ''
    }
  }
}

export {
  getWeatherConfig,
  validateStartupConfig,
  validateWeatherConfig
}
