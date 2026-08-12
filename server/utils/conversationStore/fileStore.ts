import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  Conversation,
  ConversationContextSummary,
  ConversationImportConflictStrategy,
  ConversationImportItemResult,
  StoredMessage
} from '../../types/conversation.ts'
import { DEFAULT_TITLE, type ConversationStore } from './contracts.ts'
import {
  readConversationFilesForMigration,
  readLegacyConversationAggregate
} from './migration.ts'
import {
  applyAppendedMessages,
  cloneConversation,
  createId,
  createImportedDuplicate,
  getConversationFilePath,
  isNodeError,
  normalizeConversation,
  now,
  sortConversationSummaries
} from './normalization.ts'
import {
  CONVERSATIONS_DIR,
  LEGACY_DATA_FILE,
  ROOT_CONVERSATIONS_DIR,
  ROOT_LEGACY_DATA_FILE
} from './paths.ts'

let migrationPromise: Promise<void> | null = null
const mutationQueues = new Map<string, Promise<void>>()

function isSamePath(firstPath: string, secondPath: string): boolean {
  return path.resolve(firstPath) === path.resolve(secondPath)
}

async function ensureConversationDir(): Promise<void> {
  await fs.mkdir(CONVERSATIONS_DIR, { recursive: true })
}

async function withConversationMutation<T>(
  id: string,
  mutation: () => Promise<T>
): Promise<T> {
  const previous = mutationQueues.get(id) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(mutation)
  const tail = result.then(
    () => undefined,
    () => undefined
  )
  mutationQueues.set(id, tail)

  try {
    return await result
  } finally {
    if (mutationQueues.get(id) === tail) {
      mutationQueues.delete(id)
    }
  }
}

async function writeConversationFile(conversation: Conversation): Promise<void> {
  await ensureConversationDir()

  const filePath = getConversationFilePath(conversation.id)
  if (!filePath) {
    throw new Error('会话 ID 不合法')
  }

  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(conversation, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function writeConversationFileIfAbsent(conversation: Conversation): Promise<void> {
  await withConversationMutation(conversation.id, async () => {
    await ensureConversationDir()

    const filePath = getConversationFilePath(conversation.id)
    if (!filePath) {
      throw new Error('会话 ID 不合法')
    }

    try {
      await fs.access(filePath)
      return
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error
      }
    }

    await writeConversationFile(conversation)
  })
}

async function readConversationFileRaw(id: string): Promise<Conversation | null> {
  const filePath = getConversationFilePath(id)
  if (!filePath) return null

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return normalizeConversation(JSON.parse(raw), id)
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

async function importConversationFiles(sourceDir: string): Promise<void> {
  if (isSamePath(sourceDir, CONVERSATIONS_DIR) || !existsSync(sourceDir)) {
    return
  }

  const conversations = await readConversationFilesForMigration(sourceDir, {
    skipMalformed: false,
    malformedLabel: 'conversation file'
  })
  for (const conversation of conversations) {
    await writeConversationFileIfAbsent(conversation)
  }
}

async function importLegacyAggregate(
  filePath: string,
  options: { renameAfterImport: boolean }
): Promise<void> {
  const conversations = await readLegacyConversationAggregate(filePath, {
    skipMalformed: false,
    malformedLabel: 'conversation aggregate'
  })

  for (const conversation of conversations) {
    await writeConversationFileIfAbsent(conversation)
  }

  if (options.renameAfterImport && existsSync(filePath)) {
    await fs.rename(filePath, `${filePath}.migrated`)
  }
}

async function migrateLegacyStore(): Promise<void> {
  if (migrationPromise) return migrationPromise

  migrationPromise = (async () => {
    await ensureConversationDir()
    await importConversationFiles(ROOT_CONVERSATIONS_DIR)
    await importLegacyAggregate(LEGACY_DATA_FILE, { renameAfterImport: true })
    await importLegacyAggregate(`${LEGACY_DATA_FILE}.migrated`, { renameAfterImport: false })
    await importLegacyAggregate(ROOT_LEGACY_DATA_FILE, { renameAfterImport: true })
    await importLegacyAggregate(`${ROOT_LEGACY_DATA_FILE}.migrated`, {
      renameAfterImport: false
    })
  })()

  return migrationPromise
}

async function readAllConversationFiles(): Promise<Conversation[]> {
  await migrateLegacyStore()
  await ensureConversationDir()
  return readConversationFilesForMigration(CONVERSATIONS_DIR, {
    skipMalformed: true,
    malformedLabel: 'conversation file',
    requireValidFileId: true
  })
}

async function listConversations() {
  return sortConversationSummaries(await readAllConversationFiles())
}

async function getConversation(id: string): Promise<Conversation | null> {
  await migrateLegacyStore()
  const conversation = await readConversationFileRaw(id)
  return conversation ? cloneConversation(conversation) : null
}

async function createConversation(title: unknown = DEFAULT_TITLE): Promise<Conversation> {
  await migrateLegacyStore()

  const timestamp = now()
  const normalizedTitle = typeof title === 'string' && title.trim() ? title.trim() : DEFAULT_TITLE
  const conversation: Conversation = {
    id: createId(),
    title: normalizedTitle,
    createdAt: timestamp,
    updatedAt: timestamp,
    titleManuallyEdited: normalizedTitle !== DEFAULT_TITLE,
    messages: []
  }

  await writeConversationFile(conversation)
  return cloneConversation(conversation)
}

async function renameConversation(id: string, title: unknown): Promise<Conversation | null> {
  const nextTitle = typeof title === 'string' ? title.trim() : ''
  if (!nextTitle) return null

  await migrateLegacyStore()
  return withConversationMutation(id, async () => {
    const conversation = await readConversationFileRaw(id)
    if (!conversation) return null

    conversation.title = nextTitle
    conversation.titleManuallyEdited = true
    conversation.updatedAt = now()
    await writeConversationFile(conversation)
    return cloneConversation(conversation)
  })
}

async function appendMessages(
  id: string,
  messages: StoredMessage[]
): Promise<Conversation | null> {
  await migrateLegacyStore()
  return withConversationMutation(id, async () => {
    const conversation = await readConversationFileRaw(id)
    if (!conversation) return null

    await writeConversationFile(applyAppendedMessages(conversation, messages))
    return cloneConversation(conversation)
  })
}

async function updateSummary(
  id: string,
  summary: ConversationContextSummary | null
): Promise<Conversation | null> {
  await migrateLegacyStore()
  return withConversationMutation(id, async () => {
    const conversation = await readConversationFileRaw(id)
    if (!conversation) return null

    if (summary) {
      conversation.summary = { ...summary }
    } else {
      delete conversation.summary
    }
    conversation.updatedAt = now()
    await writeConversationFile(conversation)
    return cloneConversation(conversation)
  })
}

async function importConversation(
  sourceConversation: Conversation,
  strategy: ConversationImportConflictStrategy
): Promise<ConversationImportItemResult> {
  await migrateLegacyStore()

  const conversation = normalizeConversation(sourceConversation)
  return withConversationMutation(conversation.id, async () => {
    const existing = await readConversationFileRaw(conversation.id)

    if (existing && strategy === 'skip') {
      return {
        sourceId: sourceConversation.id,
        conversationId: null,
        status: 'skipped'
      }
    }

    if (existing && strategy === 'duplicate') {
      const duplicate = createImportedDuplicate(conversation)
      await writeConversationFile(duplicate)
      return {
        sourceId: sourceConversation.id,
        conversationId: duplicate.id,
        status: 'duplicated'
      }
    }

    await writeConversationFile(conversation)
    return {
      sourceId: sourceConversation.id,
      conversationId: conversation.id,
      status: existing ? 'overwritten' : 'created'
    }
  })
}

async function clearConversation(id: string): Promise<Conversation | null> {
  await migrateLegacyStore()
  return withConversationMutation(id, async () => {
    const conversation = await readConversationFileRaw(id)
    if (!conversation) return null

    conversation.messages = []
    delete conversation.summary
    conversation.updatedAt = now()
    await writeConversationFile(conversation)
    return cloneConversation(conversation)
  })
}

async function deleteConversation(id: string): Promise<boolean> {
  await migrateLegacyStore()

  return withConversationMutation(id, async () => {
    const filePath = getConversationFilePath(id)
    if (!filePath) return false

    try {
      await fs.unlink(filePath)
      return true
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') return false
      throw error
    }
  })
}

export function createFileConversationStore(): ConversationStore {
  return {
    listConversations,
    getConversation,
    createConversation,
    renameConversation,
    appendMessages,
    updateSummary,
    importConversation,
    clearConversation,
    deleteConversation
  }
}
