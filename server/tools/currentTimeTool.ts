import type { CurrentTimeToolArgs, ToolRegistryItem } from '../types/tools.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateCurrentTimeArgs(args: unknown): CurrentTimeToolArgs {
  const value = isRecord(args) ? args : {}
  const timeZone = typeof value.timeZone === 'string' ? value.timeZone.trim() : ''

  if (!timeZone) {
    return {}
  }

  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone }).format()
  } catch {
    throw new Error('timeZone 必须是有效的 IANA 时区，例如 Asia/Shanghai')
  }

  return { timeZone }
}

const currentTimeTool: ToolRegistryItem<CurrentTimeToolArgs> = {
  name: 'getCurrentTime',
  definition: {
    type: 'function',
    function: {
      name: 'getCurrentTime',
      description: '获取当前日期和时间，可指定 IANA 时区。',
      parameters: {
        type: 'object',
        properties: {
          timeZone: {
            type: 'string',
            description: '可选 IANA 时区，例如 Asia/Shanghai、UTC'
          }
        },
        additionalProperties: false
      }
    }
  },
  validateArgs: validateCurrentTimeArgs,
  async handler(args) {
    const timeZone = args.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const formatted = new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone
    }).format(new Date())

    return `当前时间：${formatted}（${timeZone}）`
  }
}

export {
  currentTimeTool,
  validateCurrentTimeArgs
}
