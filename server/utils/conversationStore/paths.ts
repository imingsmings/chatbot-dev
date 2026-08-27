import path from 'node:path'
import { fileURLToPath } from 'node:url'

const storeDirectory = path.dirname(fileURLToPath(import.meta.url))
const serverDirectory = path.join(storeDirectory, '..', '..')

export const DATA_DIR = process.env.CONVERSATION_DATA_DIR || path.join(serverDirectory, 'data')
export const ATTACHMENTS_DIR = process.env.ATTACHMENT_DATA_DIR || path.join(DATA_DIR, 'attachments')
export const FILE_DATA_DIR = process.env.CONVERSATION_FILE_DATA_DIR || path.join(DATA_DIR, 'file')
export const CONVERSATIONS_DIR = path.join(FILE_DATA_DIR, 'conversations')
export const LEGACY_DATA_FILE = path.join(FILE_DATA_DIR, 'conversations.json')
export const ROOT_CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations')
export const ROOT_LEGACY_DATA_FILE = path.join(DATA_DIR, 'conversations.json')
export const SQLITE_DB_PATH =
  process.env.CONVERSATION_DB_PATH || path.join(DATA_DIR, 'sqlite', 'conversations.sqlite3')
