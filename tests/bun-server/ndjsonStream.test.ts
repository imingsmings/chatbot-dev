import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'bun:test'
import { startNdjsonHeartbeat, writeStreamEvent } from '../../bun-server/utils/ndjsonStream.ts'

type StreamResponse = Parameters<typeof writeStreamEvent>[0]

test('NDJSON writes await response backpressure without treating it as a closed connection', async () => {
  let payload = ''
  let releaseWrite!: () => void
  const writeReleased = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  const response = {
    destroyed: false,
    writableEnded: false,
    async write(value: string) {
      await writeReleased
      payload += value
      return true
    },
  } as unknown as StreamResponse

  const write = writeStreamEvent(response, { type: 'delta', content: 'chunk' })
  await Promise.resolve()
  assert.equal(payload, '')
  releaseWrite()
  assert.equal(await write, true)
  assert.equal(payload, '{"type":"delta","content":"chunk"}\n')
})

test('NDJSON writes reject an already closed response without writing', async () => {
  let writes = 0
  const response = {
    destroyed: true,
    writableEnded: false,
    write() {
      writes += 1
      return true
    },
  } as unknown as StreamResponse

  assert.equal(await writeStreamEvent(response, { type: 'done' }), false)
  assert.equal(writes, 0)
})

test('heartbeats send only blank lines and stop before the terminal event', async () => {
  const writes: string[] = []
  const response = {
    destroyed: false,
    writableEnded: false,
    async write(value: string) { writes.push(value); return true },
  } as unknown as StreamResponse
  const stop = await startNdjsonHeartbeat(response, () => assert.fail('unexpected close'), 10)
  try {
    assert.deepEqual(writes, ['\n'])
    await delay(35)
    assert.ok(writes.length >= 2)
    assert.ok(writes.every((value) => value === '\n'))
    await stop()
    await stop()
    await writeStreamEvent(response, { type: 'done' })
    const count = writes.length
    await delay(35)
    assert.equal(writes.length, count)
    assert.equal(writes.at(-1), '{"type":"done"}\n')
  } finally {
    await stop()
  }
})

test('heartbeat backpressure keeps only one write pending and stop awaits it', async () => {
  let writes = 0
  let release!: (written: boolean) => void
  const response = {
    destroyed: false,
    writableEnded: false,
    async write() {
      writes += 1
      if (writes === 1) return true
      return new Promise<boolean>((resolve) => { release = resolve })
    },
  } as unknown as StreamResponse
  const stop = await startNdjsonHeartbeat(response, () => assert.fail('unexpected close'), 5)
  await delay(35)
  assert.equal(writes, 2)
  let stopped = false
  const stopping = stop().then(() => { stopped = true })
  await delay(15)
  assert.equal(stopped, false)
  release(true)
  await stopping
  await delay(20)
  assert.equal(writes, 2)
})

test('heartbeat write failure releases upstream once and does not reschedule', async () => {
  for (const throwOnWrite of [false, true]) {
    let writes = 0
    let closed = 0
    const response = {
      destroyed: false,
      writableEnded: false,
      async write() {
        writes += 1
        if (writes === 1) return true
        if (throwOnWrite) throw new Error('transport closed')
        return false
      },
    } as unknown as StreamResponse
    const stop = await startNdjsonHeartbeat(response, () => { closed += 1 }, 5)
    try {
      await delay(35)
      assert.equal(writes, 2)
      assert.equal(closed, 1)
    } finally {
      await stop()
    }
  }
})

test('heartbeat does not write to a response that is already closed', async () => {
  let writes = 0
  let closed = 0
  const response = {
    destroyed: true,
    writableEnded: false,
    async write() { writes += 1; return true },
  } as unknown as StreamResponse
  const stop = await startNdjsonHeartbeat(response, () => { closed += 1 }, 5)
  await stop()
  assert.equal(writes, 0)
  assert.equal(closed, 1)
})
