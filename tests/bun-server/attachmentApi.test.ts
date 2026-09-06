import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, test } from 'bun:test'
import { startBunTestServer, type BunTestServer } from './helpers/bunTestServer.ts'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-attachment-api-'))
const originalEnv = { ...process.env }

Object.assign(process.env, {
  AUTH_ENABLED: 'false',
  CONVERSATION_DATA_DIR: dataDir,
  CONVERSATION_STORE: 'file',
  NODE_ENV: 'test',
})

const { default: createApp } = await import('../../bun-server/app.ts')
const { createNewConversation } = await import('../../bun-server/services/conversationService.ts')

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZP4sAAAAASUVORK5CYII=',
  'base64',
)

let server: BunTestServer
let origin = ''

beforeAll(async () => {
  server = startBunTestServer(createApp({
    validateRuntime: false,
    clientHosting: { enabled: false, distDir: '' },
  }))
  origin = server.origin
})

afterAll(async () => {
  await server.close()
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

test('multipart attachment API uploads, protects ownership, downloads and deletes pending files', async () => {
  const conversation = await createNewConversation('Attachment API')
  const other = await createNewConversation('Attachment API other')
  const form = new FormData()
  form.append('image', new Blob([PNG_1X1], { type: 'image/png' }), 'api.png')
  form.append('detail', 'low')

  const uploaded = await fetch(
    `${origin}/api/conversations/${encodeURIComponent(conversation.id)}/attachments`,
    { method: 'POST', body: form },
  )
  assert.equal(uploaded.status, 201, await uploaded.clone().text())
  const payload = await uploaded.json() as {
    attachment: { id: string; filename: string; detail: string; width: number; height: number }
  }
  assert.equal(payload.attachment.filename, 'api.png')
  assert.equal(payload.attachment.detail, 'low')
  assert.deepEqual(
    { width: payload.attachment.width, height: payload.attachment.height },
    { width: 1, height: 1 },
  )

  const crossConversation = await fetch(
    `${origin}/api/conversations/${encodeURIComponent(other.id)}/attachments/${payload.attachment.id}`,
  )
  assert.equal(crossConversation.status, 404)

  const downloaded = await fetch(
    `${origin}/api/conversations/${encodeURIComponent(conversation.id)}/attachments/${payload.attachment.id}`,
  )
  assert.equal(downloaded.status, 200)
  assert.equal(downloaded.headers.get('content-type'), 'image/png')
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), PNG_1X1)

  const preview = await fetch(
    `${origin}/api/conversations/${encodeURIComponent(conversation.id)}/context-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: '',
        attachmentIds: [payload.attachment.id],
        options: {
          provider: 'deepseek',
          model: 'deepseek-v4-flash-vision-exp',
        },
      }),
    },
  )
  assert.equal(preview.status, 200)
  const previewPayload = await preview.json() as {
    context: {
      messages: Array<{ attachments?: Array<{ id: string }> }>
      stats: { selectedImages: number; selectedImageBytes: number }
    }
  }
  assert.equal(previewPayload.context.stats.selectedImages, 1)
  assert.equal(previewPayload.context.stats.selectedImageBytes, PNG_1X1.length)
  assert.equal(previewPayload.context.messages.at(-1)?.attachments?.[0]?.id, payload.attachment.id)

  const unsupported = await fetch(
    `${origin}/api/conversations/${encodeURIComponent(conversation.id)}/ask`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: '',
        requestId: 'request_attachment_unsupported',
        attachmentIds: [payload.attachment.id],
        options: {
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
        },
      }),
    },
  )
  assert.equal(unsupported.status, 400)
  assert.match((await unsupported.json() as { message: string }).message, /不支持图片/)

  const deleted = await fetch(
    `${origin}/api/conversations/${encodeURIComponent(conversation.id)}/attachments/${payload.attachment.id}`,
    { method: 'DELETE' },
  )
  assert.equal(deleted.status, 204)
  assert.equal((await fetch(
    `${origin}/api/conversations/${encodeURIComponent(conversation.id)}/attachments/${payload.attachment.id}`,
  )).status, 404)
})

test('multipart attachment API rejects missing, spoofed and oversized image payloads', async () => {
  const conversation = await createNewConversation('Attachment API validation')

  const empty = await fetch(
    `${origin}/api/conversations/${encodeURIComponent(conversation.id)}/attachments`,
    { method: 'POST', body: new FormData() },
  )
  assert.equal(empty.status, 400)

  const spoofedForm = new FormData()
  spoofedForm.append('image', new Blob([Buffer.from('fake')], { type: 'image/png' }), 'fake.png')
  const spoofed = await fetch(
    `${origin}/api/conversations/${encodeURIComponent(conversation.id)}/attachments`,
    { method: 'POST', body: spoofedForm },
  )
  assert.equal(spoofed.status, 400)

  const oversizedForm = new FormData()
  oversizedForm.append(
    'image',
    new Blob([Buffer.alloc(6 * 1024 * 1024 + 1)], { type: 'image/png' }),
    'too-large.png',
  )
  const oversized = await fetch(
    `${origin}/api/conversations/${encodeURIComponent(conversation.id)}/attachments`,
    { method: 'POST', body: oversizedForm },
  )
  assert.equal(oversized.status, 413)
})
