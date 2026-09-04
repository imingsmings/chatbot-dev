import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, test } from 'bun:test'

const requireNodeModule = createRequire(import.meta.url)
const sqliteAvailable = (() => {
  try {
    requireNodeModule('node:sqlite')
    return true
  } catch {
    return false
  }
})()
const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-portable-sqlite-'))
const databasePath = path.join(dataDir, 'db', 'conversations.sqlite3')
const originalEnv = { ...process.env }

Object.assign(process.env, {
  CONVERSATION_DATA_DIR: dataDir,
  CONVERSATION_DB_PATH: databasePath,
  CONVERSATION_STORE: 'sqlite',
})
if (sqliteAvailable) await mkdir(path.dirname(databasePath), { recursive: true })

const { createImageAttachment, getConversationAttachment } = await import(
  '../../bun-server/services/attachmentService.ts'
)
const { createNewConversation } = await import('../../bun-server/services/conversationService.ts')
const { exportAllConversationsAsZip } = await import(
  '../../bun-server/services/conversationExportService.ts'
)
const { importConversationZip } = await import(
  '../../bun-server/services/conversationImportService.ts'
)
const { appendMessages, closeConversationStore, getConversation } = await import(
  '../../bun-server/utils/conversationStore.ts'
)

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZP4sAAAAASUVORK5CYII=',
  'base64',
)

afterAll(async () => {
  closeConversationStore()
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

test.skipIf(!sqliteAvailable)(
  'SQLite schema v2 ZIP preserves attachment bytes and remaps ownership',
  async () => {
    const conversation = await createNewConversation('Portable SQLite')
    const attachment = await createImageAttachment(conversation.id, {
      buffer: PNG_1X1,
      filename: 'sqlite.png',
      mediaType: 'image/png',
    })
    await appendMessages(conversation.id, [{
      role: 'user',
      content: '',
      attachments: [attachment],
    }])

    const exported = await exportAllConversationsAsZip()
    const result = await importConversationZip(exported.content, 'duplicate')
    const duplicateId = result.items[0]?.conversationId
    assert.equal(result.duplicated, 1)
    assert(duplicateId && duplicateId !== conversation.id)
    const duplicate = await getConversation(duplicateId)
    const importedAttachment = duplicate?.messages[0]?.attachments?.[0]
    assert(importedAttachment)
    assert.notEqual(importedAttachment.id, attachment.id)
    assert.deepEqual(
      (await getConversationAttachment(duplicateId, importedAttachment.id)).data,
      PNG_1X1,
    )
  },
)
