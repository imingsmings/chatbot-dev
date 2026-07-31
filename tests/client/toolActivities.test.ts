import assert from 'node:assert/strict'
import { test } from 'node:test'
import { settleRunningToolActivities } from '../../client/src/utils/toolActivities.ts'

test('settleRunningToolActivities only closes unfinished activities', () => {
  const activities = [
    { id: 'running', name: 'getWeather', status: 'running' as const },
    { id: 'done', name: 'calculate', status: 'success' as const, summary: '计算结果：42' }
  ]

  const settled = settleRunningToolActivities(activities, 'stopped', '已停止')

  assert.deepEqual(settled, [
    { id: 'running', name: 'getWeather', status: 'stopped', summary: '已停止' },
    activities[1]
  ])
  assert.equal(activities[0].status, 'running')
})

test('settleRunningToolActivities preserves arrays without running tools', () => {
  const activities = [
    { id: 'failed', name: 'getWeather', status: 'error' as const, summary: '执行失败' }
  ]

  assert.equal(settleRunningToolActivities(activities, 'error', '执行中断'), activities)
  assert.deepEqual(settleRunningToolActivities(undefined, 'error', '执行中断'), [])
})
