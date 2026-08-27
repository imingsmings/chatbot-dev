import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Conversation } from '../../types/conversation.ts'
import {
  getConversationFilePath,
  isNodeError,
  isRecord,
  normalizeConversation
} from './normalization.ts'

export async function readConversationFilesForMigration(
  sourceDir: string,
  options: {
    skipMalformed: boolean
    malformedLabel: string
    requireValidFileId?: boolean
  }
): Promise<Conversation[]> {
  if (!existsSync(sourceDir)) {
    return []
  }

  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  const conversations = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const filePath = path.join(sourceDir, entry.name)
        try {
          const raw = await fs.readFile(filePath, 'utf8')
          const fileId = entry.name.slice(0, -'.json'.length)
          const validFileId = getConversationFilePath(fileId)
          if (options.requireValidFileId && !validFileId) {
            return null
          }
          return validFileId
            ? normalizeConversation(JSON.parse(raw), fileId)
            : normalizeConversation(JSON.parse(raw))
        } catch (error) {
          if (isNodeError(error) && error.code === 'ENOENT') {
            return null
          }
          if (options.skipMalformed && error instanceof SyntaxError) {
            console.error(`Skipping malformed ${options.malformedLabel}: ${entry.name}`)
            return null
          }
          throw error
        }
      })
  )

  return conversations.filter((conversation): conversation is Conversation => conversation !== null)
}

export async function readLegacyConversationAggregate(
  filePath: string,
  options: { skipMalformed: boolean; malformedLabel: string }
): Promise<Conversation[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const data = JSON.parse(raw) as unknown
    return isRecord(data) && Array.isArray(data.conversations)
      ? data.conversations.map((conversation) => normalizeConversation(conversation))
      : []
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    if (options.skipMalformed && error instanceof SyntaxError) {
      console.error(`Skipping malformed ${options.malformedLabel}: ${path.basename(filePath)}`)
      return []
    }
    throw error
  }
}
