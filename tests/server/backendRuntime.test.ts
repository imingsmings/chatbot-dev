import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBackendSpawnOptions,
  readBackendRuntime,
} from '../cdp/helpers/backendRuntime.mjs'

test('backend runtime defaults to the Node server', () => {
  assert.deepEqual(readBackendRuntime({}), {
    runtime: 'node',
    directory: 'server',
  })
})

test('backend runtime selects the independent Bun server', () => {
  const options = createBackendSpawnOptions('/repo', {
    env: {
      CHATBOT_SERVER_RUNTIME: 'bun',
      CHATBOT_SERVER_DIR: 'bun-server',
    },
    preloads: ['/repo/tests/preload.cjs'],
  })

  assert.equal(options.command, 'bun')
  assert.deepEqual(options.args, [
    '--preload',
    '/repo/tests/preload.cjs',
    './bin/www.ts',
  ])
  assert.equal(options.cwd, '/repo/bun-server')
})

test('backend runtime rejects unsupported executables', () => {
  assert.throws(
    () => readBackendRuntime({ CHATBOT_SERVER_RUNTIME: 'deno' }),
    /must be either node or bun/,
  )
})
