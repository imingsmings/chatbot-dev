import { getConversation, listConversations } from '../utils/conversationStore.ts'
import crypto from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { MAX_PORTABLE_BACKUP_BYTES } from '../config/productLimits.ts'
import { getConversationAttachment, readStoredRecord } from './attachmentService.ts'
import type { Conversation, StoredMessage } from '../types/conversation.ts'

const EXPORT_SCHEMA_VERSION = 1
const PORTABLE_EXPORT_SCHEMA_VERSION = 2

type ConversationBackup = {
  exportedAt: string
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  source: 'chatbot-local'
  conversations: Conversation[]
}

type ConversationMarkdownExport = {
  content: string
  conversation: Conversation
  filename: string
}

type ConversationJsonExport = {
  backup: ConversationBackup
  content: string
  filename: string
}

type PortableAttachmentManifest = Awaited<ReturnType<typeof readStoredRecord>> & {
  path: string
}

type PortableConversationManifest = {
  exportedAt: string
  schemaVersion: typeof PORTABLE_EXPORT_SCHEMA_VERSION
  source: 'chatbot-local'
  conversations: Conversation[]
  attachments: PortableAttachmentManifest[]
}

type ConversationZipExport = {
  content: Buffer
  filename: string
  manifest: PortableConversationManifest
  sha256: string
}

function normalizeFilenamePart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized.slice(0, 64)
}

function createMarkdownFilename(conversation: Conversation): string {
  const titlePart = normalizeFilenamePart(conversation.title)
  const idPart = normalizeFilenamePart(conversation.id) || 'conversation'

  return `${titlePart || idPart}.md`
}

function createBackupFilename(exportedAt: string): string {
  return `chatbot-conversations-${exportedAt.slice(0, 10)}.json`
}

function createPortableBackupFilename(exportedAt: string): string {
  return `chatbot-conversations-${exportedAt.slice(0, 10)}.zip`
}

function formatMessageHeading(message: StoredMessage, index: number): string {
  const roleLabel = message.role === 'assistant' ? '助手' : '用户'
  return `## ${index + 1}. ${roleLabel}`
}

function formatReasoning(message: StoredMessage): string[] {
  if (message.role !== 'assistant' || !message.reasoningContent) {
    return []
  }

  const duration = typeof message.reasoningDurationMs === 'number'
    ? ` (${message.reasoningDurationMs}ms)`
    : ''

  return [
    '<details>',
    `<summary>思考过程${duration}</summary>`,
    '',
    message.reasoningContent,
    '',
    '</details>',
    ''
  ]
}

function formatAttachments(message: StoredMessage): string[] {
  if (!message.attachments?.length) return []
  return [
    '附件：',
    '',
    ...message.attachments.map((attachment) =>
      `- ${attachment.filename}（${attachment.mediaType}，${attachment.width}×${attachment.height}，引用：\`${attachment.id}\`）`
    ),
    '',
  ]
}

function formatGenerationDetails(message: StoredMessage): string[] {
  if (message.role !== 'assistant' || (!message.generation && !message.toolTrace?.length && !message.status)) {
    return []
  }

  const generation = message.generation
  const usage = generation?.usage
  const lines = [
    '<details>',
    '<summary>生成详情</summary>',
    '',
    `- 状态：${message.status ?? 'completed'}`
  ]

  if (generation) {
    lines.push(
      `- Provider：${generation.provider}`,
      `- 模型：${generation.model}`,
      `- 结束原因：${generation.finishReason ?? '未知'}`,
      `- 首 token 延迟：${generation.firstTokenLatencyMs === undefined ? '未知' : `${generation.firstTokenLatencyMs}ms`}`,
      `- 总耗时：${generation.totalDurationMs}ms`,
      `- 输入 token：${usage?.inputTokens ?? '未知'}`,
      `- 输出 token：${usage?.outputTokens ?? '未知'}`,
      `- 总 token：${usage?.totalTokens ?? '未知'}`,
      `- 推理 token：${usage?.reasoningTokens ?? '未知'}`,
      `- 缓存输入 token：${usage?.cachedInputTokens ?? '未知'}`
    )
  }

  if (message.toolTrace?.length) {
    lines.push('', '工具轨迹：', '')
    for (const trace of message.toolTrace) {
      lines.push(
        `- ${trace.name} · ${trace.success ? '成功' : '失败'} · ${trace.durationMs}ms：${trace.summary || '(无摘要)'}`
      )
    }
  }

  lines.push('', '</details>', '')
  return lines
}

function buildConversationMarkdown(conversation: Conversation): string {
  const lines = [
    `# ${conversation.title}`,
    '',
    `- 会话 ID：\`${conversation.id}\``,
    `- 创建时间：${conversation.createdAt}`,
    `- 更新时间：${conversation.updatedAt}`,
    `- 消息数：${conversation.messages.length}`,
    ...(conversation.modelOptions
      ? [
          `- Provider：${conversation.modelOptions.provider}`,
          `- 模型：${conversation.modelOptions.model}`,
          `- 推理：${conversation.modelOptions.reasoningEnabled ? '开启' : '关闭'}`,
          `- 推理强度：${conversation.modelOptions.reasoningEffort}`,
          ...(conversation.modelOptions.temperature === undefined
            ? []
            : [`- Temperature：${conversation.modelOptions.temperature}`]),
          ...(conversation.modelOptions.maxTokens === undefined
            ? []
            : [`- 最大输出 Tokens：${conversation.modelOptions.maxTokens}`])
        ]
      : []),
    '',
    '---',
    ''
  ]

  if (conversation.summary) {
    lines.push(
      '## 会话摘要',
      '',
      conversation.summary.content,
      '',
      `> 摘要基于 ${conversation.summary.sourceMessageCount} 条消息，更新时间：${conversation.summary.updatedAt}`,
      '',
      '---',
      ''
    )
  }

  conversation.messages.forEach((message, index) => {
    lines.push(formatMessageHeading(message, index), '')
    lines.push(...formatGenerationDetails(message))
    lines.push(...formatReasoning(message))
    lines.push(...formatAttachments(message))
    lines.push(message.content || '(空消息)', '')
  })

  return `${lines.join('\n').trimEnd()}\n`
}

async function exportConversationAsMarkdown(id: string): Promise<ConversationMarkdownExport | null> {
  const conversation = await getConversation(id)

  if (!conversation) {
    return null
  }

  return {
    content: buildConversationMarkdown(conversation),
    conversation,
    filename: createMarkdownFilename(conversation)
  }
}

async function exportAllConversationsAsJson(): Promise<ConversationJsonExport> {
  const summaries = await listConversations()
  const conversations = (await Promise.all(summaries.map((summary) => getConversation(summary.id))))
    .filter((conversation): conversation is Conversation => Boolean(conversation))
  const exportedAt = new Date().toISOString()
  const backup: ConversationBackup = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    source: 'chatbot-local',
    exportedAt,
    conversations
  }

  return {
    backup,
    content: `${JSON.stringify(backup, null, 2)}\n`,
    filename: createBackupFilename(exportedAt)
  }
}

async function exportAllConversationsAsZip(): Promise<ConversationZipExport> {
  const summaries = await listConversations()
  const conversations = (await Promise.all(summaries.map((summary) => getConversation(summary.id))))
    .filter((conversation): conversation is Conversation => Boolean(conversation))
  const entries: Record<string, Uint8Array> = {}
  const attachments: PortableAttachmentManifest[] = []
  const seenAttachmentIds = new Set<string>()
  let totalUncompressedBytes = 0

  for (const conversation of conversations) {
    for (const attachment of conversation.messages.flatMap((message) => message.attachments ?? [])) {
      if (seenAttachmentIds.has(attachment.id)) continue
      seenAttachmentIds.add(attachment.id)
      const record = await readStoredRecord(attachment.id)
      if (record.conversationId !== conversation.id) {
        throw new Error(`附件 ${attachment.id} 与会话绑定不一致`)
      }
      const stored = await getConversationAttachment(conversation.id, attachment.id)
      const archivePath = `attachments/${attachment.id}.data`
      totalUncompressedBytes += stored.data.length
      if (totalUncompressedBytes > MAX_PORTABLE_BACKUP_BYTES) {
        throw new Error(`便携备份内容不能超过 ${MAX_PORTABLE_BACKUP_BYTES / 1024 / 1024} MiB`)
      }
      entries[archivePath] = stored.data
      attachments.push({ ...record, path: archivePath })
    }
  }

  const exportedAt = new Date().toISOString()
  const manifest: PortableConversationManifest = {
    schemaVersion: PORTABLE_EXPORT_SCHEMA_VERSION,
    source: 'chatbot-local',
    exportedAt,
    conversations,
    attachments,
  }
  const manifestBytes = strToU8(`${JSON.stringify(manifest, null, 2)}\n`)
  totalUncompressedBytes += manifestBytes.length
  if (totalUncompressedBytes > MAX_PORTABLE_BACKUP_BYTES) {
    throw new Error(`便携备份内容不能超过 ${MAX_PORTABLE_BACKUP_BYTES / 1024 / 1024} MiB`)
  }
  entries['manifest.json'] = manifestBytes
  const content = Buffer.from(zipSync(entries, { level: 0 }))
  const sha256 = crypto.createHash('sha256').update(content).digest('hex')

  return {
    content,
    filename: createPortableBackupFilename(exportedAt),
    manifest,
    sha256,
  }
}

export {
  EXPORT_SCHEMA_VERSION,
  PORTABLE_EXPORT_SCHEMA_VERSION,
  exportAllConversationsAsJson,
  exportAllConversationsAsZip,
  exportConversationAsMarkdown
}

export type {
  ConversationBackup,
  ConversationJsonExport,
  ConversationZipExport,
  PortableConversationManifest,
  ConversationMarkdownExport
}
