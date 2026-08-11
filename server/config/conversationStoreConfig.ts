type ConversationStoreKind = 'file' | 'sqlite'

const FILE_STORE_ALIASES = new Set(['file', 'json', 'fs'])
const SQLITE_STORE_ALIASES = new Set(['sqlite', 'sqlite3'])

function readConversationStoreKind(value = process.env.CONVERSATION_STORE): ConversationStoreKind {
  const normalized = value?.trim().toLowerCase() ?? ''
  if (!normalized) {
    return 'sqlite'
  }
  if (FILE_STORE_ALIASES.has(normalized)) {
    return 'file'
  }
  if (SQLITE_STORE_ALIASES.has(normalized)) {
    return 'sqlite'
  }
  throw new Error(`不支持 "${value}"，当前支持：file、json、fs、sqlite、sqlite3`)
}

export { readConversationStoreKind }
export type { ConversationStoreKind }
