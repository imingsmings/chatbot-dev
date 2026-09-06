import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { writeStreamEvent } from '../../bun-server/utils/ndjsonStream.ts'

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
