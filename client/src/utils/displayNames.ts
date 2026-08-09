const providerNames: Record<string, string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
}

const modelNames: Record<string, string> = {
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
}

const reasoningEffortNames: Record<string, string> = {
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

export function formatProviderName(value: string) {
  return providerNames[value.toLowerCase()] ?? value
}

export function formatModelName(value: string) {
  const knownName = modelNames[value.toLowerCase()]
  if (knownName) return knownName

  const gptModel = value.match(/^gpt-([\d.]+)-(.+)$/i)
  if (!gptModel) return value

  const [, version, variant] = gptModel
  return `GPT-${version} ${variant.split('-').map(capitalize).join(' ')}`
}

export function formatReasoningEffort(value: string) {
  return reasoningEffortNames[value.toLowerCase()] ?? value
}

export function formatStorageBackend(value: string) {
  return value.toLowerCase() === 'sqlite' ? 'SQLite' : capitalize(value.toLowerCase())
}
