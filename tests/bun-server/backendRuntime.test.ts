import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'bun:test'
import {
  createBackendSpawnOptions,
  readBackendRuntime,
} from '../cdp/helpers/backendRuntime.mjs'

test('CDP backend runtime defaults to the canonical Bun backend', () => {
  assert.deepEqual(readBackendRuntime({}), {
    runtime: 'bun',
    directory: 'bun-server',
  })
})

test('CDP backend runtime accepts a custom Bun directory', () => {
  assert.deepEqual(readBackendRuntime({
    CHATBOT_SERVER_RUNTIME: 'bun',
    CHATBOT_SERVER_DIR: 'custom-bun-server',
  }), {
    runtime: 'bun',
    directory: 'custom-bun-server',
  })
})

test('CDP backend runtime rejects removed runtimes', () => {
  assert.throws(
    () => readBackendRuntime({ CHATBOT_SERVER_RUNTIME: 'node' }),
    /must be bun/,
  )
})

test('CDP backend spawn uses Bun preloads and the canonical entrypoint', () => {
  const result = createBackendSpawnOptions('/repo', {
    env: { CHATBOT_SERVER_RUNTIME: 'bun' },
    preloads: ['./mock-a.mjs', './mock-b.mjs'],
  })

  assert.equal(result.command, 'bun')
  assert.deepEqual(result.args, [
    '--preload',
    './mock-a.mjs',
    '--preload',
    './mock-b.mjs',
    './bin/www.ts',
  ])
  assert.equal(result.cwd, path.resolve('/repo', 'bun-server'))
})
