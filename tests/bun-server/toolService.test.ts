import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { calculateExpression, validateCalculatorArgs } from '../../bun-server/tools/calculatorTool.ts'
import { validateCurrentTimeArgs } from '../../bun-server/tools/currentTimeTool.ts'
import { executeToolCalls, getToolDefinitions } from '../../bun-server/services/toolService.ts'
import { formatDate, getWeather } from '../../bun-server/utils/weatherHandler.ts'
import type { ToolExecutionEvent } from '../../bun-server/types/tools.ts'

test('calculator handles precedence, parentheses, powers and validation errors', () => {
  assert.equal(calculateExpression('(12 + 8) * 3 / 2'), 30)
  assert.equal(calculateExpression('2 ^ 3 ^ 2'), 512)
  assert.equal(calculateExpression('-4 + 10 % 4'), -2)
  assert.throws(() => calculateExpression('1 / 0'), /除以 0/)
  assert.throws(() => validateCalculatorArgs({ expression: 'process.exit()' }), /不支持的字符/)
})

test('current time validation accepts IANA zones and rejects invalid zones', () => {
  assert.deepEqual(validateCurrentTimeArgs({ timeZone: 'Asia/Shanghai' }), {
    timeZone: 'Asia/Shanghai'
  })
  assert.throws(() => validateCurrentTimeArgs({ timeZone: 'Mars/Base' }), /IANA/)
})

test('weather date parsing uses local calendar dates at timezone boundaries', () => {
  const nearUtcBoundary = new Date(2026, 0, 2, 0, 30)
  assert.equal(formatDate('今天', nearUtcBoundary), '2026-01-02')
  assert.equal(formatDate('明天', nearUtcBoundary), '2026-01-03')
  assert.equal(formatDate('2026-02-03', nearUtcBoundary), '2026-02-03')
  assert.equal(formatDate('下周', nearUtcBoundary), null)
})

test('weather city lookup network failures use a stable recoverable error', async () => {
  const originalFetch = globalThis.fetch
  const originalHost = process.env.HEFENG_API_HOST
  const originalKey = process.env.HEFENG_API_KEY
  process.env.HEFENG_API_HOST = 'mock.weather.local'
  process.env.HEFENG_API_KEY = 'test-key'
  globalThis.fetch = async () => {
    throw new TypeError('network down')
  }

  try {
    await assert.rejects(
      getWeather({ city: '北京', date: '今天' }),
      /天气查询服务暂时不可用/,
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalHost === undefined) delete process.env.HEFENG_API_HOST
    else process.env.HEFENG_API_HOST = originalHost
    if (originalKey === undefined) delete process.env.HEFENG_API_KEY
    else process.env.HEFENG_API_KEY = originalKey
  }
})

test('tool registry exposes weather, time and calculator and emits execution events', async () => {
  const names = getToolDefinitions().map((tool) => tool.function.name)
  assert.deepEqual(names, ['getWeather', 'getCurrentTime', 'calculate'])

  const events: ToolExecutionEvent[] = []
  const results = await executeToolCalls([
    { id: 'call_time', function: 'getCurrentTime', args: { timeZone: 'UTC' } },
    { id: 'call_calc', function: 'calculate', args: { expression: '6 * 7' } },
    { id: 'call_missing', function: 'missingTool', args: {} }
  ], {
    onEvent: (event) => events.push(event)
  })

  assert.match(results[0].result, /UTC/)
  assert.equal(results[1].result, '计算结果：42')
  assert.equal(results[2].result, 'unknown tool')
  assert.deepEqual(events.map((event) => event.type), [
    'tool_start', 'tool_result',
    'tool_start', 'tool_result',
    'tool_start', 'tool_result'
  ])
  const lastEvent = events.at(-1)
  assert.equal(lastEvent?.type, 'tool_result')
  if (lastEvent?.type === 'tool_result') {
    assert.equal(lastEvent.success, false)
  }
})

test('weather provider errors emit failed tool results instead of successful text results', async () => {
  const originalFetch = globalThis.fetch
  const originalHost = process.env.HEFENG_API_HOST
  const originalKey = process.env.HEFENG_API_KEY
  const events: ToolExecutionEvent[] = []

  process.env.HEFENG_API_HOST = 'mock.weather.local'
  process.env.HEFENG_API_KEY = 'test-key'
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    if (url.includes('/geo/v2/city/lookup')) {
      return Response.json({
        code: '200',
        location: [{ id: 'failed-location' }]
      })
    }

    return Response.json({
      code: '500',
      daily: []
    })
  }

  try {
    const results = await executeToolCalls([
      {
        id: 'call_weather_failure',
        function: 'getWeather',
        args: {
          city: '异常城',
          date: '今天'
        }
      }
    ], {
      onEvent: (event) => events.push(event)
    })

    assert.match(results[0].result, /Failed to call tool 获取天气数据失败/)
    assert.deepEqual(events.map((event) => event.type), ['tool_start', 'tool_result'])
    assert.equal(events[1].type === 'tool_result' && events[1].success, false)
  } finally {
    globalThis.fetch = originalFetch

    if (originalHost === undefined) {
      delete process.env.HEFENG_API_HOST
    } else {
      process.env.HEFENG_API_HOST = originalHost
    }

    if (originalKey === undefined) {
      delete process.env.HEFENG_API_KEY
    } else {
      process.env.HEFENG_API_KEY = originalKey
    }
  }
})
