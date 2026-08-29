import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  Conversation,
  ConversationContextSummary,
  ConversationImportConflictStrategy,
  ConversationImportItemResult,
  ConversationModelOptions,
  ConversationRequestRecord,
  ConversationRequestStatus,
  StoredMessage
} from '../../types/conversation.ts'
import { DEFAULT_TITLE, type ConversationStore } from './contracts.ts'
import {
  readConversationFilesForMigration,
  readLegacyConversationAggregate
} from './migration.ts'
import {
  applyAppendedMessages,
  assertUniqueRequestBindings,
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
let storeMutationQueue = Promise.resolve()

type FileConversationStoreOptions = {
  beforeImportCommit?: (index: number) => void | Promise<void>
}

async function withStoreMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = storeMutationQueue.catch(() => undefined).then(mutation)
  storeMutationQueue = result.then(() => undefined, () => undefined)
  return result
}

async function waitForStoreMutations(): Promise<void> {
  await storeMutationQueue
}

function isSamePath(firstPath: string, secondPath: string): boolean {
  return path.resolve(firstPath) === path.resolve(secondPath)
}

async function ensureConversationDir(): Promise<void> {
  await fs.mkdir(CONVERSATIONS_DIR, { recursive: true })
}

async function checkHealth(): Promise<void> {
  await listConversations()
  const nonce = crypto.randomUUID()
  const probePath = path.join(CONVERSATIONS_DIR, `.health-${process.pid}-${nonce}`)

  try {
    await fs.writeFile(probePath, nonce, { encoding: 'utf8', flag: 'wx' })
    const storedNonce = await fs.readFile(probePath, 'utf8')
    if (storedNonce !== nonce) {
      throw new Error('文件存储健康检查内容不一致')
    }
  } finally {
    await fs.rm(probePath, { force: true }).catch(() => undefined)
  }
}

async function withConversationMutation<T>(
  id: string,
  mutation: () => Promise<T>
): Promise<T> {
  const previous = mutationQueues.get(id) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(() => withStoreMutation(mutation))
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
  await waitForStoreMutations()
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
  await waitForStoreMutations()
  await migrateLegacyStore()
  const conversation = await readConversationFileRaw(id)
  return conversation ? cloneConversation(conversation) : null
}

async function createConversation(
  title: unknown = DEFAULT_TITLE,
  modelOptions?: ConversationModelOptions
): Promise<Conversation> {
  await migrateLegacyStore()

  const timestamp = now()
  const normalizedTitle = typeof title === 'string' && title.trim() ? title.trim() : DEFAULT_TITLE
  const conversation: Conversation = {
    id: createId(),
    title: normalizedTitle,
    createdAt: timestamp,
    updatedAt: timestamp,
    titleManuallyEdited: normalizedTitle !== DEFAULT_TITLE,
    messages: [],
    ...(modelOptions ? { modelOptions: { ...modelOptions } } : {})
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

async function beginRequest(
  id: string,
  request: ConversationRequestRecord
): Promise<ConversationRequestRecord | null> {
  await migrateLegacyStore()
  return withConversationMutation(id, async () => {
    const conversation = await readConversationFileRaw(id)
    if (!conversation) return null
    const existing = conversation.requests?.find(({ requestId }) => requestId === request.requestId)
    if (existing) return { ...existing }
    conversation.requests = [...(conversation.requests ?? []), { ...request }]
    await writeConversationFile(conversation)
    return { ...request }
  })
}

async function findRequest(requestId: string): Promise<{
  conversationId: string
  request: ConversationRequestRecord
} | null> {
  const conversations = await readAllConversationFiles()
  for (const conversation of conversations) {
    const request = conversation.requests?.find((item) => item.requestId === requestId)
    if (request) return { conversationId: conversation.id, request: { ...request } }
  }
  return null
}

async function finalizeRequest(
  id: string,
  requestId: string,
  status: Exclude<ConversationRequestStatus, 'processing'>,
  messages: StoredMessage[] = []
): Promise<ConversationRequestRecord | null> {
  await migrateLegacyStore()
  return withConversationMutation(id, async () => {
    const conversation = await readConversationFileRaw(id)
    if (!conversation) return null
    const request = conversation.requests?.find((item) => item.requestId === requestId)
    if (!request) return null
    if (request.status !== 'processing') return { ...request }

    if (messages.length) {
      request.messageStartIndex = conversation.messages.length
      request.messageCount = messages.length
      applyAppendedMessages(conversation, messages)
    }
    request.status = status
    request.updatedAt = now()
    await writeConversationFile(conversation)
    return { ...request }
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

async function updateModelOptions(
  id: string,
  options: ConversationModelOptions
): Promise<Conversation | null> {
  await migrateLegacyStore()
  return withConversationMutation(id, async () => {
    const conversation = await readConversationFileRaw(id)
    if (!conversation) return null

    conversation.modelOptions = { ...options }
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

async function importConversations(
  sourceConversations: Conversation[],
  strategy: ConversationImportConflictStrategy,
  options: FileConversationStoreOptions = {}
): Promise<ConversationImportItemResult[]> {
  await migrateLegacyStore()
  return withStoreMutation(async () => {
    const planned: Array<{
      conversation?: Conversation
      item: ConversationImportItemResult
    }> = []
    const sourceIds = new Set<string>()
    for (const sourceConversation of sourceConversations) {
      if (sourceIds.has(sourceConversation.id)) {
        throw new Error(`批次包含重复会话 ID：${sourceConversation.id}`)
      }
      sourceIds.add(sourceConversation.id)
      const conversation = normalizeConversation(sourceConversation)
      const existing = await readConversationFileRaw(conversation.id)
      if (existing && strategy === 'skip') {
        planned.push({
          item: { sourceId: sourceConversation.id, conversationId: null, status: 'skipped' }
        })
        continue
      }
      const target = existing && strategy === 'duplicate'
        ? createImportedDuplicate(conversation)
        : conversation
      planned.push({
        conversation: target,
        item: {
          sourceId: sourceConversation.id,
          conversationId: target.id,
          status: existing ? (strategy === 'duplicate' ? 'duplicated' : 'overwritten') : 'created'
        }
      })
    }

    const finalConversations = new Map(
      (await readConversationFilesForMigration(CONVERSATIONS_DIR, {
        skipMalformed: true,
        malformedLabel: 'conversation file',
        requireValidFileId: true
      })).map((conversation) => [conversation.id, conversation])
    )
    for (const entry of planned) {
      if (entry.conversation) finalConversations.set(entry.conversation.id, entry.conversation)
    }
    assertUniqueRequestBindings([...finalConversations.values()])

    const stagingRoot = path.join(CONVERSATIONS_DIR, `.import-${crypto.randomUUID()}`)
    const stagedDir = path.join(stagingRoot, 'staged')
    const backupDir = path.join(stagingRoot, 'backup')
    const committed: Array<{ targetPath: string; backupPath: string | null }> = []
    try {
      await fs.mkdir(stagedDir, { recursive: true })
      await fs.mkdir(backupDir, { recursive: true })
      for (const entry of planned) {
        if (!entry.conversation) continue
        await fs.writeFile(
          path.join(stagedDir, `${entry.conversation.id}.json`),
          `${JSON.stringify(entry.conversation, null, 2)}\n`,
          { encoding: 'utf8', flag: 'wx' }
        )
      }

      let commitIndex = 0
      for (const entry of planned) {
        if (!entry.conversation) continue
        await options.beforeImportCommit?.(commitIndex)
        commitIndex += 1
        const targetPath = getConversationFilePath(entry.conversation.id)
        if (!targetPath) throw new Error('会话 ID 不合法')
        const stagedPath = path.join(stagedDir, `${entry.conversation.id}.json`)
        const backupPath = path.join(backupDir, `${entry.conversation.id}.json`)
        let preservedPath: string | null = null
        try {
          await fs.rename(targetPath, backupPath)
          preservedPath = backupPath
        } catch (error) {
          if (!isNodeError(error) || error.code !== 'ENOENT') throw error
        }
        try {
          await fs.rename(stagedPath, targetPath)
          committed.push({ targetPath, backupPath: preservedPath })
        } catch (error) {
          if (preservedPath) await fs.rename(preservedPath, targetPath)
          throw error
        }
      }
      return planned.map(({ item }) => item)
    } catch (error) {
      for (const entry of committed.reverse()) {
        await fs.rm(entry.targetPath, { force: true })
        if (entry.backupPath) await fs.rename(entry.backupPath, entry.targetPath)
      }
      throw error
    } finally {
      await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
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
    delete conversation.requests
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

export function createFileConversationStore(
  options: FileConversationStoreOptions = {}
): ConversationStore {
  return {
    checkHealth,
    listConversations,
    getConversation,
    createConversation,
    renameConversation,
    appendMessages,
    beginRequest,
    findRequest,
    finalizeRequest,
    updateSummary,
    updateModelOptions,
    importConversation,
    importConversations: (conversations, strategy) =>
      importConversations(conversations, strategy, options),
    clearConversation,
    deleteConversation
  }
}
