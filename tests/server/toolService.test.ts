import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateExpression, validateCalculatorArgs } from '../../server/tools/calculatorTool.ts'
import { validateCurrentTimeArgs } from '../../server/tools/currentTimeTool.ts'
import { executeToolCalls, getToolDefinitions } from '../../server/services/toolService.ts'
import type { ToolExecutionEvent } from '../../server/types/tools.ts'

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
