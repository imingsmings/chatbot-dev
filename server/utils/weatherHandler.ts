import { getWeatherConfig } from './runtimeConfig.ts'
import type { ToolExecutionOptions, WeatherToolArgs } from '../types/tools.ts'

type QWeatherCityLookupResponse = {
  code?: string
  location?: Array<{
    id: string
  }>
}

type QWeatherDailyResponse = {
  code?: string
  daily?: Array<{
    fxDate: string
    textDay: string
    tempMin: string
    tempMax: string
  }>
}

const DAY_MS = 86_400_000

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(text: string, currentDate = new Date()): string | null {
  const today = new Date(currentDate)

  if (text.includes('今天')) return formatLocalDate(today)
  if (text.includes('明天')) {
    const tomorrow = new Date(today.getTime() + DAY_MS)
    return formatLocalDate(tomorrow)
  }
  if (text.includes('后天')) {
    const dayAfter = new Date(today.getTime() + 2 * DAY_MS)
    return formatLocalDate(dayAfter)
  }

  if (text.toLowerCase().includes('today')) return formatLocalDate(today)
  if (text.toLowerCase().includes('tomorrow')) {
    const tomorrow = new Date(today.getTime() + DAY_MS)
    return formatLocalDate(tomorrow)
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  return null
}

async function getCityLocation(city: string, options: ToolExecutionOptions = {}): Promise<string | null> {
  const { signal } = options
  const { host, headers } = getWeatherConfig()
  const url = `https://${host}/geo/v2/city/lookup?location=${encodeURIComponent(city)}`

  const res = await fetch(url, {
    method: 'GET',
    signal,
    headers
  })

  if (!res.ok) {
    throw new Error(`城市查询请求失败：${res.status}`)
  }

  const data = (await res.json()) as QWeatherCityLookupResponse
  const [location] = data.location ?? []

  if (data.code === '200' && location) {
    return location.id
  }

  return null
}

function normalizeWeatherArgs(args: unknown): WeatherToolArgs {
  const value = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}

  return {
    city: typeof value.city === 'string' ? value.city : '',
    date: typeof value.date === 'string' ? value.date : ''
  }
}

async function getWeather(args: unknown, options: ToolExecutionOptions = {}): Promise<string> {
  const { city, date } = normalizeWeatherArgs(args)
  const { signal } = options
  const formattedDate = formatDate(date)

  if (!city.trim()) {
    throw new Error('城市不能为空')
  }

  if (!formattedDate) {
    throw new Error(`无法识别日期格式："${date}"，请使用"今天"、"明天"或"后天"`)
  }

  try {
    const locationId = await getCityLocation(city, { signal })
    if (!locationId) {
      throw new Error(`无法识别城市："${city}"`)
    }

    const { host, headers } = getWeatherConfig()
    const url = `https://${host}/v7/weather/7d?location=${locationId}`
    const res = await fetch(url, {
      method: 'GET',
      signal,
      headers
    })
    if (!res.ok) {
      throw new Error(`天气请求失败：${res.status}`)
    }
    const data = (await res.json()) as QWeatherDailyResponse // 拿到的是一周的天气

    if (data.code !== '200') {
      throw new Error('获取天气数据失败')
    }

    const match = data.daily?.find((d) => d.fxDate === formattedDate) // 过滤出需要的那一天的天气数据
    if (!match) {
      return `暂无 ${formattedDate} 的天气数据`
    }

    const result = `📍 ${city}（${formattedDate}）天气：${match.textDay}，气温 ${match.tempMin}°C ~ ${match.tempMax}°C`
    return result
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }

    if (
      error instanceof Error &&
      (error.message === '获取天气数据失败' || error.message.startsWith('无法识别城市'))
    ) {
      throw error
    }

    throw new Error('天气查询服务暂时不可用')
  }
}

export {
  formatDate,
  getWeather
}

// function main() {
//   getWeather({
//     city: '北京',
//     date: '2026-05-19'
//   })
// }

// main()
