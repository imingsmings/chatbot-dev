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

const root = await mkdtemp(path.join(tmpdir(), 'chatbot-sqlite-runtime-compatibility-'))
const dataDir = path.join(root, 'shared')
const provider = await startMockProvider()
let backend

try {
  backend = await startBackend({
    runtime: 'node',
    directory: 'server',
    repoRoot: REPO_ROOT,
    port: await findAvailablePort(),
    dataDir,
    providerUrl: provider.url,
    store: 'sqlite',
  })
  const createdByNode = await requestJson(backend.origin, '/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Node SQLite source' }),
  })
  assert.equal(createdByNode.status, 201)
  const nodeConversationId = createdByNode.body.conversation.id
  const askResponse = await fetch(`${backend.origin}/api/conversations/${nodeConversationId}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'Persist this before the Bun migration',
      requestId: 'sqlite_runtime_compatibility_001',
    }),
  })
  assert.equal(askResponse.status, 200)
  const stream = await askResponse.text()
  assert.match(stream, /"type":"done"/)
  assert.equal(provider.callCount, 1)
  await stopBackend(backend)
  backend = undefined

  backend = await startBackend({
    runtime: 'bun',
    directory: 'bun-server',
    repoRoot: REPO_ROOT,
    port: await findAvailablePort(),
    dataDir,
    providerUrl: provider.url,
    store: 'sqlite',
  })
  const reopenedByBun = await requestJson(
    backend.origin,
    `/api/conversations/${nodeConversationId}`,
  )
  assert.equal(reopenedByBun.status, 200)
  assert.equal(reopenedByBun.body.conversation.messages[0]?.content, 'Persist this before the Bun migration')
  assert.equal(reopenedByBun.body.conversation.messages[1]?.content, 'Bun parity answer')
  const renamedByBun = await requestJson(
    backend.origin,
    `/api/conversations/${nodeConversationId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bun reopened Node SQLite' }),
    },
  )
  assert.equal(renamedByBun.status, 200)
  const createdByBun = await requestJson(backend.origin, '/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Bun SQLite rollback row' }),
  })
  assert.equal(createdByBun.status, 201)
  const bunConversationId = createdByBun.body.conversation.id
  await stopBackend(backend)
  backend = undefined

  backend = await startBackend({
    runtime: 'node',
    directory: 'server',
    repoRoot: REPO_ROOT,
    port: await findAvailablePort(),
    dataDir,
    providerUrl: provider.url,
    store: 'sqlite',
  })
  const bunUpdatedConversation = await requestJson(
    backend.origin,
    `/api/conversations/${nodeConversationId}`,
  )
  const bunCreatedConversation = await requestJson(
    backend.origin,
    `/api/conversations/${bunConversationId}`,
  )
  assert.equal(bunUpdatedConversation.status, 200)
  assert.equal(bunUpdatedConversation.body.conversation.title, 'Bun reopened Node SQLite')
  assert.equal(bunCreatedConversation.status, 200)
  assert.equal(bunCreatedConversation.body.conversation.title, 'Bun SQLite rollback row')
  assert.equal(provider.callCount, 1, 'runtime switches unexpectedly repeated a Provider request')

  console.log(JSON.stringify({
    status: 'passed',
    providerCalls: provider.callCount,
    transitions: ['node:sqlite -> bun:sqlite', 'bun:sqlite -> node:sqlite'],
  }))
} finally {
  await stopBackend(backend)
  await provider.close()
  await rm(root, { recursive: true, force: true })
}
