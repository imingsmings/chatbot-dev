type ValidationIssue = {
  name: string
  reason: string
}

const SUPPORTED_LLM_PROVIDERS = new Set(['deepseek'])
const SUPPORTED_CONVERSATION_STORES = new Set(['file', 'json', 'fs', 'sqlite', 'sqlite3'])
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

function readProvider(): string {
  return (process.env.LLM_PROVIDER || 'deepseek').trim().toLowerCase()
}

function readStoreKind(): string {
  return (process.env.CONVERSATION_STORE || 'file').trim().toLowerCase()
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

function validatePositiveIntegerEnv(name: string, issues: ValidationIssue[]): void {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    return
  }

  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    issues.push({
      name,
      reason: '必须是正整数'
    })
  }
}

function formatConfigError(title: string, issues: ValidationIssue[]): Error {
  return new Error(`${title}：${issues.map((item) => `${item.name} ${item.reason}`).join('；')}`)
}

function validateStartupConfig(): void {
  const issues: ValidationIssue[] = []
  const provider = readProvider()
  const storeKind = readStoreKind()

  if (!SUPPORTED_LLM_PROVIDERS.has(provider)) {
    issues.push({
      name: 'LLM_PROVIDER',
      reason: `不支持 "${process.env.LLM_PROVIDER}"，当前支持：${[...SUPPORTED_LLM_PROVIDERS].join(', ')}`
    })
  }

  requireConfigValue('LLM_ENDPOINT', issues)
  requireConfigValue('LLM_MODEL', issues)

  if (provider === 'deepseek') {
    requireConfigValue('DEEPSEEK_API_KEY', issues)
  }

  if (!SUPPORTED_CONVERSATION_STORES.has(storeKind)) {
    issues.push({
      name: 'CONVERSATION_STORE',
      reason: `不支持 "${process.env.CONVERSATION_STORE}"，当前支持：file、json、fs、sqlite、sqlite3`
    })
  }

  validatePositiveIntegerEnv('LLM_TIMEOUT_MS', issues)
  validateBooleanEnv('LLM_REASONING_ENABLED', issues)

  if (issues.length > 0) {
    throw formatConfigError('后端启动配置错误', issues)
  }
}

function validateWeatherConfig(): void {
  const issues: ValidationIssue[] = []

  requireConfigValue('HEFENG_API_HOST', issues)
  requireConfigValue('HEFENG_API_KEY', issues)

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
