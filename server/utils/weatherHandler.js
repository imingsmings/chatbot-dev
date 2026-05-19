const HEFENG_API_HOST = process.env.HEFENG_API_HOST
const HEFENG_API_KEY = process.env.HEFENG_API_KEY

function formatDate(text) {
  const today = new Date()

  if (text.includes('今天')) return today.toISOString().split('T')[0]
  if (text.includes('明天')) {
    const tomorrow = new Date(today.getTime() + 86400000)
    return tomorrow.toISOString().split('T')[0]
  }
  if (text.includes('后天')) {
    const dayAfter = new Date(today.getTime() + 2 * 86400000)
    return dayAfter.toISOString().split('T')[0]
  }

  if (text.toLowerCase().includes('today')) return today.toISOString().split('T')[0]
  if (text.toLowerCase().includes('tomorrow')) {
    const tomorrow = new Date(today.getTime() + 86400000)
    return tomorrow.toISOString().split('T')[0]
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  return null
}

async function getCityLocation(city, options = {}) {
  const { signal } = options
  const url = `https://${HEFENG_API_HOST}/geo/v2/city/lookup?location=${encodeURIComponent(city)}`

  const res = await fetch(url, {
    method: 'GET',
    signal,
    headers: {
      'X-QW-Api-Key': HEFENG_API_KEY
    }
  })

  const data = await res.json()

  if (data.code === '200' && data.location?.length > 0) {
    return data.location[0].id
  }

  return null
}

async function getWeather({ city, date }, options = {}) {
  const { signal } = options
  const formattedDate = formatDate(date)

  if (!formattedDate) {
    console.error('无法识别日期格式:', date)
    return `无法识别日期格式："${date}"，请使用"今天"、"明天"或"后天"`
  }

  const locationId = await getCityLocation(city, { signal })
  if (!locationId) {
    console.error('无法识别城市:', city)
    return `无法识别城市："${city}"`
  }

  try {
    const url = `https://${HEFENG_API_HOST}/v7/weather/7d?location=${locationId}`
    const res = await fetch(url, {
      method: 'GET',
      signal,
      headers: {
        'X-QW-Api-Key': HEFENG_API_KEY
      }
    })
    const data = await res.json() // 拿到的是一周的天气

    if (data.code !== '200') {
      console.error('天气API返回错误:', data.code)
      return '获取天气数据失败'
    }

    const match = data.daily.find((d) => d.fxDate === formattedDate) // 过滤出需要的那一天的天气数据
    if (!match) {
      console.error('没有找到对应日期的天气数据:', formattedDate)
      return `暂无 ${formattedDate} 的天气数据`
    }

    const result = `📍 ${city}（${formattedDate}）天气：${match.textDay}，气温 ${match.tempMin}°C ~ ${match.tempMax}°C`
    console.log('天气查询成功:', result)
    return result
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error
    }

    console.error('天气查询异常:', error)
    return '天气查询服务暂时不可用'
  }
}

export {
  getWeather
}

// function main() {
//   getWeather({
//     city: '北京',
//     date: '2026-05-19'
//   })
// }

// main()
