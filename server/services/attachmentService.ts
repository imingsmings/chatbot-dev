import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  DEFAULT_ATTACHMENT_ORPHAN_TTL_MS,
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_IMAGE_ATTACHMENT_EDGE,
  MAX_IMAGE_ATTACHMENTS_PER_MESSAGE,
} from '../config/productLimits.ts'
import type {
  ImageAttachment,
  ImageAttachmentDetail,
  ImageAttachmentMediaType,
  LlmPromptMessage,
  PromptContentBlock,
  PromptMessage,
  StoredMessage,
} from '../types/conversation.ts'
import { getConversation, listConversations } from '../utils/conversationStore.ts'
import { ATTACHMENTS_DIR } from '../utils/conversationStore/paths.ts'

const ATTACHMENT_ID_PATTERN = /^att_[0-9a-f-]{36}$/
const RECORD_SUFFIX = '.json'
const DATA_SUFFIX = '.data'

type StoredAttachmentRecord = ImageAttachment & {
  conversationId: string
  createdAt: string
  sha256: string
}

type ImageUpload = {
  buffer: Buffer
  filename: string
  mediaType: string
  detail?: ImageAttachmentDetail
}

class AttachmentError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'AttachmentError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeFilename(value: string): string {
  const name = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (name || 'image').slice(0, 255)
}

function getRecordPath(id: string): string {
  if (!ATTACHMENT_ID_PATTERN.test(id)) throw new AttachmentError('附件 ID 不合法')
  return path.join(ATTACHMENTS_DIR, `${id}${RECORD_SUFFIX}`)
}

function getDataPath(id: string): string {
  if (!ATTACHMENT_ID_PATTERN.test(id)) throw new AttachmentError('附件 ID 不合法')
  return path.join(ATTACHMENTS_DIR, `${id}${DATA_SUFFIX}`)
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return null
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2

  while (offset + 3 < buffer.length) {
    while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    if (offset >= buffer.length) break
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) break
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      }
    }
    offset += segmentLength
  }

  return null
}

function readWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null
  }

  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    return {
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
    }
  }
  if (chunk === 'VP8L' && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }
  if (
    chunk === 'VP8 ' &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  ) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }
  return null
}

function inspectImage(buffer: Buffer): {
  mediaType: ImageAttachmentMediaType
  width: number
  height: number
} {
  const png = readPngDimensions(buffer)
  if (png) return { mediaType: 'image/png', ...png }

  const jpeg = readJpegDimensions(buffer)
  if (jpeg) return { mediaType: 'image/jpeg', ...jpeg }

  const webp = readWebpDimensions(buffer)
  if (webp) return { mediaType: 'image/webp', ...webp }

  throw new AttachmentError('只支持实际内容为 JPEG、PNG 或 WebP 的图片')
}

function toPublicAttachment(record: StoredAttachmentRecord): ImageAttachment {
  return {
    id: record.id,
    kind: 'image',
    filename: record.filename,
    mediaType: record.mediaType,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    detail: record.detail,
  }
}

function parseStoredRecord(value: unknown): StoredAttachmentRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !ATTACHMENT_ID_PATTERN.test(value.id) ||
    value.kind !== 'image' ||
    typeof value.filename !== 'string' ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(String(value.mediaType)) ||
    typeof value.byteSize !== 'number' ||
    !Number.isInteger(value.byteSize) ||
    value.byteSize < 1 ||
    value.byteSize > MAX_IMAGE_ATTACHMENT_BYTES ||
    typeof value.width !== 'number' ||
    !Number.isInteger(value.width) ||
    value.width < 1 ||
    value.width > MAX_IMAGE_ATTACHMENT_EDGE ||
    typeof value.height !== 'number' ||
    !Number.isInteger(value.height) ||
    value.height < 1 ||
    value.height > MAX_IMAGE_ATTACHMENT_EDGE ||
    !['auto', 'low', 'original'].includes(String(value.detail)) ||
    typeof value.conversationId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.sha256)
  ) {
    throw new AttachmentError('附件元数据损坏', 500)
  }

  return value as StoredAttachmentRecord
}

async function readStoredRecord(id: string): Promise<StoredAttachmentRecord> {
  try {
    const value = JSON.parse(await fs.readFile(getRecordPath(id), 'utf8')) as unknown
    return parseStoredRecord(value)
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AttachmentError('附件不存在', 404)
    }
    throw error
  }
}

async function writeStoredAttachment(record: StoredAttachmentRecord, buffer: Buffer): Promise<void> {
  await fs.mkdir(ATTACHMENTS_DIR, { recursive: true })
  const dataPath = getDataPath(record.id)
  const recordPath = getRecordPath(record.id)
  const nonce = `${process.pid}.${crypto.randomUUID()}.tmp`
  const temporaryDataPath = `${dataPath}.${nonce}`
  const temporaryRecordPath = `${recordPath}.${nonce}`

  try {
    await fs.writeFile(temporaryDataPath, buffer, { flag: 'wx' })
    await fs.writeFile(temporaryRecordPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await fs.rename(temporaryDataPath, dataPath)
    await fs.rename(temporaryRecordPath, recordPath)
  } catch (error) {
    await Promise.all([
      fs.rm(temporaryDataPath, { force: true }),
      fs.rm(temporaryRecordPath, { force: true }),
      fs.rm(dataPath, { force: true }),
      fs.rm(recordPath, { force: true }),
    ])
    throw error
  }
}

async function createImageAttachment(
  conversationId: string,
  upload: ImageUpload,
): Promise<ImageAttachment> {
  if (!await getConversation(conversationId)) {
    throw new AttachmentError('会话不存在', 404)
  }
  if (upload.buffer.length < 1) throw new AttachmentError('图片不能为空')
  if (upload.buffer.length > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new AttachmentError(`单张图片不能超过 ${MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024} MiB`, 413)
  }

  const inspected = inspectImage(upload.buffer)
  if (upload.mediaType && upload.mediaType !== 'application/octet-stream' && upload.mediaType !== inspected.mediaType) {
    throw new AttachmentError('声明的图片类型与实际内容不一致')
  }
  if (
    inspected.width > MAX_IMAGE_ATTACHMENT_EDGE ||
    inspected.height > MAX_IMAGE_ATTACHMENT_EDGE
  ) {
    throw new AttachmentError(`图片单边不能超过 ${MAX_IMAGE_ATTACHMENT_EDGE} 像素`)
  }

  const record: StoredAttachmentRecord = {
    id: `att_${crypto.randomUUID()}`,
    kind: 'image',
    filename: sanitizeFilename(upload.filename),
    mediaType: inspected.mediaType,
    byteSize: upload.buffer.length,
    width: inspected.width,
    height: inspected.height,
    detail: upload.detail ?? 'auto',
    conversationId,
    createdAt: new Date().toISOString(),
    sha256: crypto.createHash('sha256').update(upload.buffer).digest('hex'),
  }
  await writeStoredAttachment(record, upload.buffer)
  void cleanupOrphanedAttachments().catch((error) => {
    console.warn('Failed to clean orphaned attachments after upload:', error)
  })
  return toPublicAttachment(record)
}

async function getConversationAttachment(
  conversationId: string,
  attachmentId: string,
): Promise<{ attachment: ImageAttachment; data: Buffer }> {
  const record = await readStoredRecord(attachmentId)
  if (record.conversationId !== conversationId) {
    throw new AttachmentError('附件不存在', 404)
  }
  const data = await fs.readFile(getDataPath(record.id)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new AttachmentError('附件文件不存在', 404)
    throw error
  })
  if (
    data.length !== record.byteSize ||
    crypto.createHash('sha256').update(data).digest('hex') !== record.sha256
  ) {
    throw new AttachmentError('附件文件校验失败', 500)
  }
  return { attachment: toPublicAttachment(record), data }
}

function messageReferencesAttachment(message: StoredMessage, attachmentId: string): boolean {
  return message.attachments?.some((attachment) => attachment.id === attachmentId) ?? false
}

async function deleteConversationAttachment(
  conversationId: string,
  attachmentId: string,
): Promise<void> {
  const record = await readStoredRecord(attachmentId)
  if (record.conversationId !== conversationId) throw new AttachmentError('附件不存在', 404)
  const conversation = await getConversation(conversationId)
  if (conversation?.messages.some((message) => messageReferencesAttachment(message, attachmentId))) {
    throw new AttachmentError('已发送的附件不能单独删除', 409)
  }
  await Promise.all([
    fs.rm(getDataPath(attachmentId), { force: true }),
    fs.rm(getRecordPath(attachmentId), { force: true }),
  ])
}

async function resolveConversationAttachments(
  conversationId: string,
  attachmentIds: string[],
): Promise<ImageAttachment[]> {
  if (attachmentIds.length > MAX_IMAGE_ATTACHMENTS_PER_MESSAGE) {
    throw new AttachmentError(`单条消息最多包含 ${MAX_IMAGE_ATTACHMENTS_PER_MESSAGE} 张图片`)
  }
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    throw new AttachmentError('附件 ID 不能重复')
  }

  return Promise.all(attachmentIds.map(async (attachmentId) => {
    const { attachment } = await getConversationAttachment(conversationId, attachmentId)
    return attachment
  }))
}

async function materializePromptAttachments(
  conversationId: string,
  prompt: PromptMessage[],
): Promise<LlmPromptMessage[]> {
  return Promise.all(prompt.map(async (message) => {
    if (!message.attachments?.length) return { ...message }
    if (message.role !== 'user') {
      throw new AttachmentError('图片只能用于 user 消息', 500)
    }

    const blocks: PromptContentBlock[] = []
    if (typeof message.content === 'string' && message.content) {
      blocks.push({ type: 'text', text: message.content })
    }
    for (const attachment of message.attachments) {
      const stored = await getConversationAttachment(conversationId, attachment.id)
      blocks.push({
        type: 'image_url',
        image_url: {
          url: `data:${stored.attachment.mediaType};base64,${stored.data.toString('base64')}`,
          detail: stored.attachment.detail,
        },
      })
    }
    const { attachments: ignored, ...rest } = message
    void ignored
    return { ...rest, content: blocks }
  }))
}

async function copyAttachment(
  sourceConversationId: string,
  targetConversationId: string,
  attachment: ImageAttachment,
): Promise<ImageAttachment> {
  const source = await getConversationAttachment(sourceConversationId, attachment.id)
  const copiedRecord: StoredAttachmentRecord = {
    ...source.attachment,
    id: `att_${crypto.randomUUID()}`,
    conversationId: targetConversationId,
    createdAt: new Date().toISOString(),
    sha256: crypto.createHash('sha256').update(source.data).digest('hex'),
  }
  await writeStoredAttachment(copiedRecord, source.data)
  return toPublicAttachment(copiedRecord)
}

async function cloneMessageAttachments(
  sourceConversationId: string,
  targetConversationId: string,
  messages: StoredMessage[],
): Promise<{ messages: StoredMessage[]; createdAttachmentIds: string[] }> {
  const mapping = new Map<string, ImageAttachment>()
  const createdAttachmentIds: string[] = []

  try {
    const clonedMessages: StoredMessage[] = []
    for (const message of messages) {
      const attachments: ImageAttachment[] = []
      for (const attachment of message.attachments ?? []) {
        let copied = mapping.get(attachment.id)
        if (!copied) {
          copied = await copyAttachment(sourceConversationId, targetConversationId, attachment)
          mapping.set(attachment.id, copied)
          createdAttachmentIds.push(copied.id)
        }
        attachments.push(copied)
      }
      clonedMessages.push({
        ...message,
        ...(attachments.length ? { attachments } : { attachments: undefined }),
      })
    }
    return { messages: clonedMessages, createdAttachmentIds }
  } catch (error) {
    await removeAttachmentFiles(createdAttachmentIds)
    throw error
  }
}

async function removeAttachmentFiles(attachmentIds: string[]): Promise<void> {
  await Promise.all(attachmentIds.flatMap((id) => [
    fs.rm(getDataPath(id), { force: true }),
    fs.rm(getRecordPath(id), { force: true }),
  ]))
}

async function cleanupOrphanedAttachments(options: {
  now?: number
  ttlMs?: number
  maxDeletes?: number
} = {}): Promise<number> {
  const now = options.now ?? Date.now()
  const configuredTtlMs = Number(process.env.ATTACHMENT_ORPHAN_TTL_MS)
  const ttlMs = options.ttlMs ?? (
    Number.isFinite(configuredTtlMs) && configuredTtlMs >= 0
      ? configuredTtlMs
      : DEFAULT_ATTACHMENT_ORPHAN_TTL_MS
  )
  const maxDeletes = options.maxDeletes ?? 100
  const summaries = await listConversations()
  const conversations = (await Promise.all(summaries.map(({ id }) => getConversation(id))))
    .filter((conversation) => conversation !== null)
  const referenced = new Set(
    conversations.flatMap((conversation) =>
      conversation.messages.flatMap((message) => message.attachments?.map(({ id }) => id) ?? []),
    ),
  )

  let entries: string[] = []
  try {
    entries = await fs.readdir(ATTACHMENTS_DIR)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }

  let deleted = 0
  for (const entry of entries) {
    if (deleted >= maxDeletes) break
    if (!entry.endsWith(RECORD_SUFFIX)) continue
    const id = entry.slice(0, -RECORD_SUFFIX.length)
    if (!ATTACHMENT_ID_PATTERN.test(id) || referenced.has(id)) continue
    try {
      const record = await readStoredRecord(id)
      if (now - Date.parse(record.createdAt) < ttlMs) continue
      await removeAttachmentFiles([id])
      deleted += 1
    } catch (error) {
      if (!(error instanceof AttachmentError && error.status === 404)) throw error
    }
  }
  return deleted
}

async function checkAttachmentStorageHealth(): Promise<void> {
  await fs.mkdir(ATTACHMENTS_DIR, { recursive: true })
  const probePath = path.join(
    ATTACHMENTS_DIR,
    `.health-${process.pid}-${crypto.randomUUID()}`,
  )
  const nonce = crypto.randomUUID()
  try {
    await fs.writeFile(probePath, nonce, { encoding: 'utf8', flag: 'wx' })
    if (await fs.readFile(probePath, 'utf8') !== nonce) {
      throw new Error('附件存储健康检查内容不一致')
    }
  } finally {
    await fs.rm(probePath, { force: true }).catch(() => undefined)
  }
}

export {
  ATTACHMENT_ID_PATTERN,
  AttachmentError,
  checkAttachmentStorageHealth,
  cleanupOrphanedAttachments,
  cloneMessageAttachments,
  createImageAttachment,
  deleteConversationAttachment,
  getConversationAttachment,
  inspectImage,
  materializePromptAttachments,
  parseStoredRecord,
  readStoredRecord,
  removeAttachmentFiles,
  resolveConversationAttachments,
  writeStoredAttachment,
}

export type { ImageUpload, StoredAttachmentRecord }
