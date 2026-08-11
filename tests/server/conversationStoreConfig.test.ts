import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { readConversationStoreKind } from '../../server/config/conversationStoreConfig.ts'

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...originalEnv }
  delete process.env.CONVERSATION_STORE
})

after(() => {
  process.env = originalEnv
})

test('conversation storage defaults to SQLite', () => {
  assert.equal(readConversationStoreKind(), 'sqlite')
  assert.equal(readConversationStoreKind(''), 'sqlite')
  assert.equal(readConversationStoreKind('   '), 'sqlite')
})

test('conversation storage keeps explicit file and SQLite aliases', () => {
  assert.equal(readConversationStoreKind('file'), 'file')
  assert.equal(readConversationStoreKind('json'), 'file')
  assert.equal(readConversationStoreKind('fs'), 'file')
  assert.equal(readConversationStoreKind('sqlite'), 'sqlite')
  assert.equal(readConversationStoreKind('sqlite3'), 'sqlite')
})

test('conversation storage rejects unsupported values', () => {
  assert.throws(() => readConversationStoreKind('postgres'), /当前支持/)
})
