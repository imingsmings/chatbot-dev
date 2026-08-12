import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-import-file-'))
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'

after(async () => {
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

const { importConversationBackup } = await import('../../server/services/conversationImportService.ts')
const { getConversation, listConversations } = await import('../../server/utils/conversationStore.ts')

function backup(content = 'original') {
  return {
    schemaVersion: 1,
    source: 'chatbot-local',
    exportedAt: '2026-07-31T00:00:00.000Z',
    conversations: [{
      id: 'conv_import_file',
      title: 'Imported file',
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      titleManuallyEdited: true,
      summary: {
        content: 'imported summary',
        sourceMessageCount: 1,
        updatedAt: '2026-07-31T00:00:00.000Z'
      },
      messages: [{ role: 'user', content }]
    }]
  }
}

test('file import supports create, skip, duplicate and explicit overwrite', async () => {
  const created = await importConversationBackup(backup())
  assert.equal(created.created, 1)
  assert.equal((await getConversation('conv_import_file'))?.summary?.content, 'imported summary')

  const skipped = await importConversationBackup(backup('skipped'), 'skip')
  assert.equal(skipped.skipped, 1)
  assert.equal((await getConversation('conv_import_file'))?.messages[0]?.content, 'original')

  const duplicated = await importConversationBackup(backup('duplicate'), 'duplicate')
  assert.equal(duplicated.duplicated, 1)
  assert.notEqual(duplicated.items[0].conversationId, 'conv_import_file')
  assert.equal((await listConversations()).length, 2)

  const overwritten = await importConversationBackup(backup('overwritten'), 'overwrite')
  assert.equal(overwritten.overwritten, 1)
  assert.equal((await getConversation('conv_import_file'))?.messages[0]?.content, 'overwritten')
})

test('file import clamps summary coverage to the imported message count', async () => {
  const imported = backup('legacy message')
  imported.conversations[0].id = 'conv_import_summary_clamp_file'
  imported.conversations[0].summary.sourceMessageCount = 99

  await importConversationBackup(imported)

  assert.equal(
    (await getConversation('conv_import_summary_clamp_file'))?.summary?.sourceMessageCount,
    1
  )
})

test('file import preserves optional generation and tool metadata while accepting legacy messages', async () => {
  const imported = backup('legacy user message')
  imported.conversations[0].id = 'conv_import_generation_file'
  Object.assign(imported.conversations[0], {
    messages: [
      { role: 'user', content: 'legacy user message' },
      {
        role: 'assistant',
        content: 'partial answer',
        status: 'stopped',
        generation: {
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          firstTokenLatencyMs: 10,
          totalDurationMs: 50,
          usage: { inputTokens: 9 }
        },
        toolTrace: [{
          name: 'calculate',
          success: true,
          durationMs: 2,
          summary: '计算结果：42'
        }]
      }
    ]
  })

  await importConversationBackup(imported)
  const stored = await getConversation('conv_import_generation_file')
  assert.equal(stored?.messages[0]?.status, undefined)
  assert.equal(stored?.messages[1]?.status, 'stopped')
  assert.equal(stored?.messages[1]?.generation?.usage?.totalTokens, undefined)
  assert.deepEqual(stored?.messages[1]?.generation?.usage, { inputTokens: 9 })
  assert.equal(stored?.messages[1]?.toolTrace?.[0]?.summary, '计算结果：42')
})

test('file import rejects unsupported and malformed backups without partial writes', async () => {
  const countBeforeValidationFailures = (await listConversations()).length

  await assert.rejects(
    importConversationBackup({ schemaVersion: 99, source: 'chatbot-local', conversations: [] }),
    /只支持/
  )
  await assert.rejects(
    importConversationBackup({
      ...backup(),
      conversations: [{ ...backup().conversations[0], id: '../invalid' }]
    }),
    /id 不合法/
  )
  await assert.rejects(
    importConversationBackup({
      ...backup(),
      conversations: [{
        ...backup().conversations[0],
        id: 'conv_invalid_boolean',
        titleManuallyEdited: 'false'
      }]
    }),
    /titleManuallyEdited 必须是布尔值/
  )
  await assert.rejects(
    importConversationBackup({
      ...backup(),
      conversations: [
        { ...backup().conversations[0], id: 'conv_duplicate_in_backup' },
        { ...backup().conversations[0], id: 'conv_duplicate_in_backup' }
      ]
    }),
    /重复会话 id/
  )
  await assert.rejects(
    importConversationBackup({
      ...backup(),
      conversations: [{
        ...backup().conversations[0],
        id: 'conv_invalid_generation',
        messages: [{
          role: 'assistant',
          content: 'invalid usage',
          status: 'completed',
          generation: {
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            totalDurationMs: 10,
            usage: { totalTokens: -1 }
          }
        }]
      }]
    }),
    /totalTokens 必须是非负整数/
  )

  assert.equal((await listConversations()).length, countBeforeValidationFailures)
})
