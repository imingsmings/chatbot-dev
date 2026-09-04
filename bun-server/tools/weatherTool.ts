import { getWeather } from '../utils/weatherHandler.ts'
import type { ToolHandler, ToolRegistryItem, WeatherToolArgs } from '../types/tools.ts'

const WEATHER_DATE_OPTIONS = ['今天', '明天', '后天'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

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

const weatherTool: ToolRegistryItem<WeatherToolArgs> = {
  name: 'getWeather',
  definition: {
    type: 'function',
    function: {
      name: 'getWeather',
      description: '获取指定中文城市在今天、明天或后天的天气信息。',
      strict: true,
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
  handler: getWeather as ToolHandler<WeatherToolArgs>,
  validateArgs: validateWeatherArgs
}

export {
  validateWeatherArgs,
  weatherTool
}
