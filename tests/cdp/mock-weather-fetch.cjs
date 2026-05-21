const originalFetch = globalThis.fetch.bind(globalThis)

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    }
  })
}

function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url

  if (url.includes('mock.weather.local/geo/v2/city/lookup')) {
    const parsed = new URL(url)
    const city = parsed.searchParams.get('location') || ''
    const id = city.includes('异常') ? 'fail-location' : city.includes('慢') ? 'slow-location' : 'beijing-location'

    return json({
      code: '200',
      location: [{ id }],
    })
  }

  if (url.includes('mock.weather.local/v7/weather/7d')) {
    const parsed = new URL(url)
    const location = parsed.searchParams.get('location') || ''

    if (location === 'slow-location') {
      await delay(2000, init.signal)
    }

    if (location === 'fail-location') {
      return json({ code: '500', daily: [] })
    }

    const today = new Date()
    const dates = Array.from({ length: 3 }, (_, index) => {
      const date = new Date(today.getTime() + index * 86400000)
      return date.toISOString().split('T')[0]
    })

    return json({
      code: '200',
      daily: dates.map((fxDate) => ({
        fxDate,
        textDay: '晴',
        tempMin: '18',
        tempMax: '26',
      })),
    })
  }

  return originalFetch(input, init)
}
