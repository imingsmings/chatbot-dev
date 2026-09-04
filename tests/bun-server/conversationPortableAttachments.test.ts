import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, test } from 'bun:test'
import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
} from '../../bun-server/node_modules/fflate/esm/index.mjs'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-portable-file-'))
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'

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
const { appendMessages, getConversation, listConversations } = await import(
  '../../bun-server/utils/conversationStore.ts'
)

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAusB9Y9ZP4sAAAAASUVORK5CYII=',
  'base64',
)

afterAll(async () => {
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

async function createPortableFixture() {
  const conversation = await createNewConversation('Portable image backup')
  const attachment = await createImageAttachment(conversation.id, {
    buffer: PNG_1X1,
    filename: 'portable.png',
    mediaType: 'image/png',
    detail: 'low',
  })
  await appendMessages(conversation.id, [{
    role: 'user',
    content: 'portable image',
    attachments: [attachment],
  }])
  return { attachment, conversation }
}

test('schema v2 ZIP round-trips attachment bytes with new local ids', async () => {
  const { attachment, conversation } = await createPortableFixture()
  const exported = await exportAllConversationsAsZip()
  const entries = unzipSync(exported.content)
  const manifestText = strFromU8(entries['manifest.json'])

  assert.equal(exported.manifest.schemaVersion, 2)
  assert.match(exported.filename, /^chatbot-conversations-\d{4}-\d{2}-\d{2}\.zip$/)
  assert.match(exported.sha256, /^[0-9a-f]{64}$/)
  assert(!manifestText.includes('data:image/'))
  assert.deepEqual(Buffer.from(entries[`attachments/${attachment.id}.data`]), PNG_1X1)

  const imported = await importConversationZip(exported.content, 'duplicate')
  assert.equal(imported.duplicated, 1)
  const duplicateId = imported.items.find(({ sourceId }) => sourceId === conversation.id)?.conversationId
  assert(duplicateId && duplicateId !== conversation.id)
  const duplicate = await getConversation(duplicateId)
  const duplicateAttachment = duplicate?.messages[0]?.attachments?.[0]
  assert(duplicateAttachment)
  assert.notEqual(duplicateAttachment.id, attachment.id)
  assert.deepEqual(
    (await getConversationAttachment(duplicateId, duplicateAttachment.id)).data,
    PNG_1X1,
  )
})

test('schema v2 ZIP rejects checksum corruption and unsafe extra paths without partial writes', async () => {
  const exported = await exportAllConversationsAsZip()
  const entries = unzipSync(exported.content)
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as {
    attachments: Array<{ sha256: string }>
  }
  assert(manifest.attachments.length > 0)
  manifest.attachments[0].sha256 = '0'.repeat(64)
  const corrupted = Buffer.from(zipSync({
    ...entries,
    'manifest.json': strToU8(JSON.stringify(manifest)),
  }, { level: 0 }))
  const conversationCount = (await listConversations()).length
  const attachmentFilesBefore = await readdir(path.join(dataDir, 'attachments'))

  await assert.rejects(importConversationZip(corrupted, 'duplicate'), /校验失败/)
  assert.equal((await listConversations()).length, conversationCount)
  assert.deepEqual(await readdir(path.join(dataDir, 'attachments')), attachmentFilesBefore)

  const unsafe = Buffer.from(zipSync({
    ...entries,
    '../outside.txt': strToU8('unsafe'),
  }, { level: 0 }))
  await assert.rejects(importConversationZip(unsafe, 'duplicate'), /不允许的路径/)
  assert.equal((await listConversations()).length, conversationCount)
})
