import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { writeStreamEvent } from '../../bun-server/utils/ndjsonStream.ts'

type StreamResponse = Parameters<typeof writeStreamEvent>[0]

test('NDJSON writes do not treat response backpressure as a closed connection', () => {
  let payload = ''
  const response = {
    destroyed: false,
    writableEnded: false,
    write(value: string) {
      payload += value
      return false
    },
  } as unknown as StreamResponse

  assert.equal(writeStreamEvent(response, { type: 'delta', content: 'chunk' }), true)
  assert.equal(payload, '{"type":"delta","content":"chunk"}\n')
})

test('NDJSON writes reject an already closed response without writing', () => {
  let writes = 0
  const response = {
    destroyed: true,
    writableEnded: false,
    write() {
      writes += 1
      return true
    },
  } as unknown as StreamResponse

  assert.equal(writeStreamEvent(response, { type: 'done' }), false)
  assert.equal(writes, 0)
})
