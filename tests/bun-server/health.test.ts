import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, test } from 'bun:test'

const testRoot = await mkdtemp(path.join(tmpdir(), 'chatbot-health-'))
const dataDir = path.join(testRoot, 'data')

Object.assign(process.env, {
  CONVERSATION_DATA_DIR: dataDir,
  CONVERSATION_STORE: 'file',
  DEEPSEEK_API_KEY: 'test-key',
  LLM_ENDPOINT: 'https://provider.invalid/v1',
  LLM_PROVIDER: 'deepseek'
})

const { createApp } = await import('../../bun-server/app.ts')

type TestServer = {
  origin: string
  close: () => Promise<void>
}

async function startTestServer(): Promise<TestServer> {
  const app = createApp({
    validateRuntime: false,
    clientHosting: { enabled: false, distDir: '' }
  })
  const server = http.createServer(app)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  assert(address && typeof address !== 'string')

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

afterAll(async () => {
  await rm(testRoot, { recursive: true, force: true })
})

test('health reports configuration and storage readiness without sensitive details', async () => {
  const server = await startTestServer()

  try {
    const [compatibilityResponse, readinessResponse, livenessResponse] = await Promise.all([
      fetch(`${server.origin}/api/health`),
      fetch(`${server.origin}/api/health/ready`),
      fetch(`${server.origin}/api/health/live`),
    ])

    assert.equal(compatibilityResponse.status, 200)
    assert.deepEqual(await compatibilityResponse.json(), {
      status: 'ok',
      checks: {
        configuration: 'ok',
        storage: 'ok'
      }
    })
    assert.equal(readinessResponse.status, 200)
    assert.deepEqual(await readinessResponse.json(), {
      status: 'ok',
      checks: {
        configuration: 'ok',
        storage: 'ok'
      }
    })
    assert.equal(livenessResponse.status, 200)
    assert.deepEqual(await livenessResponse.json(), { status: 'ok' })
  } finally {
    await server.close()
  }
})

test('health returns 503 when the data directory is not writable', async () => {
  await rm(dataDir, { recursive: true, force: true })
  await writeFile(dataDir, 'blocks directory creation')
  const server = await startTestServer()

  try {
    const [response, livenessResponse] = await Promise.all([
      fetch(`${server.origin}/api/health/ready`),
      fetch(`${server.origin}/api/health/live`),
    ])

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      status: 'unhealthy',
      checks: {
        configuration: 'ok',
        storage: 'error'
      }
    })
    assert.equal(livenessResponse.status, 200)
    assert.deepEqual(await livenessResponse.json(), { status: 'ok' })
  } finally {
    await server.close()
    await rm(dataDir, { force: true })
    await mkdir(dataDir, { recursive: true })
  }
})

test('health returns 503 for invalid runtime configuration while storage remains usable', async () => {
  const previousProvider = process.env.LLM_PROVIDER
  process.env.LLM_PROVIDER = 'unsupported-provider'
  const server = await startTestServer()

  try {
    const response = await fetch(`${server.origin}/api/health/ready`)

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      status: 'unhealthy',
      checks: {
        configuration: 'error',
        storage: 'ok'
      }
    })
  } finally {
    await server.close()
    process.env.LLM_PROVIDER = previousProvider
  }
})
