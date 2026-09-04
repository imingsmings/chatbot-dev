import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  findAvailablePort,
  startBackend,
  startMockProvider,
  stopBackend,
} from './backendHarness.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

async function requestJson(origin, pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, options)
  const body = response.status === 204 ? null : await response.json()
  return { status: response.status, body }
}

function normalizeRuntimeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeRuntimeValue)
  if (!value || typeof value !== 'object') return value

  const normalized = {}
  for (const [key, child] of Object.entries(value)) {
    if (
      ['id', 'createdAt', 'updatedAt', 'startedAt', 'completedAt'].includes(key) ||
      /(?:Duration|Latency)Ms$/.test(key)
    ) continue
    normalized[key] = normalizeRuntimeValue(child)
  }
  return normalized
}

async function readNdjson(response) {
  const text = await response.text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map(normalizeRuntimeValue)
}

async function exerciseBackend(handle) {
  const live = await requestJson(handle.origin, '/api/health/live')
  const ready = await requestJson(handle.origin, '/api/health/ready')
  const runtime = await requestJson(handle.origin, '/api/runtime-config')
  const created = await requestJson(handle.origin, '/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Runtime parity' }),
  })
  assert.equal(created.status, 201)
  const conversationId = created.body.conversation.id
  const askResponse = await fetch(`${handle.origin}/api/conversations/${conversationId}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'Return the deterministic parity answer',
      requestId: 'runtime_parity_request_001',
    }),
  })
  assert.equal(askResponse.status, 200)
  const stream = await readNdjson(askResponse)
  const detail = await requestJson(handle.origin, `/api/conversations/${conversationId}`)
  const renamed = await requestJson(handle.origin, `/api/conversations/${conversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Runtime parity renamed' }),
  })

  return {
    conversationId,
    result: normalizeRuntimeValue({ live, ready, runtime, created, stream, detail, renamed }),
  }
}

const root = await mkdtemp(path.join(tmpdir(), 'chatbot-backend-parity-'))
const provider = await startMockProvider()
let nodeHandle
let bunHandle

try {
  nodeHandle = await startBackend({
    runtime: 'node',
    directory: 'server',
    repoRoot: REPO_ROOT,
    port: await findAvailablePort(),
    dataDir: path.join(root, 'node'),
    providerUrl: provider.url,
  })
  bunHandle = await startBackend({
    runtime: 'bun',
    directory: 'bun-server',
    repoRoot: REPO_ROOT,
    port: await findAvailablePort(),
    dataDir: path.join(root, 'bun'),
    providerUrl: provider.url,
  })

  const nodeResult = await exerciseBackend(nodeHandle)
  const bunResult = await exerciseBackend(bunHandle)
  assert.deepEqual(bunResult.result, nodeResult.result)
  assert.equal(provider.callCount, 2)

  await stopBackend(nodeHandle)
  await stopBackend(bunHandle)
  nodeHandle = await startBackend({
    runtime: 'node',
    directory: 'server',
    repoRoot: REPO_ROOT,
    port: await findAvailablePort(),
    dataDir: path.join(root, 'node'),
    providerUrl: provider.url,
  })
  bunHandle = await startBackend({
    runtime: 'bun',
    directory: 'bun-server',
    repoRoot: REPO_ROOT,
    port: await findAvailablePort(),
    dataDir: path.join(root, 'bun'),
    providerUrl: provider.url,
  })

  const nodePersisted = await requestJson(nodeHandle.origin, `/api/conversations/${nodeResult.conversationId}`)
  const bunPersisted = await requestJson(bunHandle.origin, `/api/conversations/${bunResult.conversationId}`)
  assert.deepEqual(normalizeRuntimeValue(bunPersisted), normalizeRuntimeValue(nodePersisted))
  assert.equal(provider.callCount, 2, 'restart unexpectedly repeated a Provider request')

  console.log(JSON.stringify({
    status: 'passed',
    providerCalls: provider.callCount,
    eventTypes: nodeResult.result.stream.map((event) => event.type),
  }))
} finally {
  await Promise.allSettled([
    stopBackend(nodeHandle),
    stopBackend(bunHandle),
  ])
  await provider.close()
  await rm(root, { recursive: true, force: true })
}
