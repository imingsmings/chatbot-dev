import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testRoot = await mkdtemp(path.join(tmpdir(), 'chatbot-health-sqlite-'))
const dataDir = path.join(testRoot, 'read-only-data')
const databaseDir = path.join(testRoot, 'database')
const databasePath = path.join(databaseDir, 'custom.sqlite3')

await mkdir(dataDir, { recursive: true })
await mkdir(databaseDir, { recursive: true })
await chmod(dataDir, 0o555)

Object.assign(process.env, {
  CONVERSATION_DATA_DIR: dataDir,
  CONVERSATION_DB_PATH: databasePath,
  CONVERSATION_STORE: 'sqlite',
  DEEPSEEK_API_KEY: 'test-key',
  LLM_ENDPOINT: 'https://provider.invalid/v1',
  LLM_PROVIDER: 'deepseek'
})

const { getHealthStatus } = await import('../../server/services/healthService.ts')
const { closeConversationStore } = await import('../../server/utils/conversationStore.ts')

after(async () => {
  closeConversationStore()
  await chmod(dataDir, 0o755).catch(() => undefined)
  await chmod(databaseDir, 0o755).catch(() => undefined)
  await chmod(databasePath, 0o644).catch(() => undefined)
  await rm(testRoot, { recursive: true, force: true })
})

test('SQLite health probes the configured database instead of the generic data directory', async () => {
  assert.deepEqual(await getHealthStatus(), {
    status: 'ok',
    checks: {
      configuration: 'ok',
      storage: 'ok'
    }
  })

  await chmod(databasePath, 0o444)
  await chmod(databaseDir, 0o555)
  assert.deepEqual(await getHealthStatus(), {
    status: 'unhealthy',
    checks: {
      configuration: 'ok',
      storage: 'error'
    }
  })

  await chmod(databasePath, 0o644)
  await chmod(databaseDir, 0o755)
  assert.equal((await getHealthStatus()).status, 'ok')
})
