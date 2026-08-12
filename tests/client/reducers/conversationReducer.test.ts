import { describe, expect, it } from 'vitest'

import type { ConversationDetail } from '../../../client/src/types/chat'
import {
  conversationReducer,
  createInitialConversationState,
  mapStoredMessages,
} from '../../../client/src/reducers/conversationReducer'

function createConversation(
  id: string,
  updatedAt: string,
  messages: ConversationDetail['messages'] = [],
): ConversationDetail {
  return {
    id,
    title: `会话 ${id}`,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt,
    messageCount: messages.length,
    messages,
  }
}

describe('conversation reducer', () => {
  it('upserts and sorts summaries without mutating the previous list', () => {
    const older = createConversation('older', '2026-07-31T01:00:00.000Z')
    const newer = createConversation('newer', '2026-07-31T02:00:00.000Z')
    const initial = {
      ...createInitialConversationState(),
      conversations: [
        {
          id: older.id,
          title: older.title,
          createdAt: older.createdAt,
          updatedAt: older.updatedAt,
          messageCount: 0,
        },
      ],
    }

    const next = conversationReducer(initial, {
      type: 'upsert-conversation',
      conversation: newer,
    })

    expect(next.conversations.map((conversation) => conversation.id)).toEqual([
      'newer',
      'older',
    ])
    expect(initial.conversations.map((conversation) => conversation.id)).toEqual(['older'])
    expect(next.conversations).not.toBe(initial.conversations)
  })

  it('selects a detail and maps persisted reasoning fields to completed messages', () => {
    const conversation = createConversation('selected', '2026-07-31T02:00:00.000Z', [
      { role: 'user', content: '问题' },
      {
        role: 'assistant',
        content: '答案',
        reasoningContent: '分析',
        reasoningDurationMs: 320,
      },
    ])

    const next = conversationReducer(createInitialConversationState(), {
      type: 'select-conversation',
      conversation,
    })

    expect(next.currentConversationId).toBe('selected')
    expect(next.messages).toEqual(mapStoredMessages(conversation))
    expect(next.messages[1]).toMatchObject({
      id: 'selected-1-assistant',
      persistedIndex: 1,
      reasoningText: '分析',
      reasoningDurationMs: 320,
      status: 'done',
    })
  })

  it('maps stopped generation metadata and persisted tool traces without inventing usage', () => {
    const conversation = createConversation('metadata', '2026-08-12T02:00:00.000Z', [
      { role: 'user', content: '问题' },
      {
        role: 'assistant',
        content: '部分回答',
        status: 'stopped',
        generation: {
          provider: 'openai',
          model: 'gpt-5.6-terra',
          firstTokenLatencyMs: 15,
          totalDurationMs: 80,
        },
        toolTrace: [{
          name: 'calculate',
          success: true,
          durationMs: 3,
          summary: '计算结果：42',
        }],
      },
    ])

    const mapped = mapStoredMessages(conversation)
    expect(mapped[1]).toMatchObject({
      status: 'stopped',
      generation: {
        provider: 'openai',
        model: 'gpt-5.6-terra',
        firstTokenLatencyMs: 15,
        totalDurationMs: 80,
      },
      toolActivities: [{
        name: 'calculate',
        status: 'success',
        durationMs: 3,
        summary: '计算结果：42',
      }],
    })
    expect(mapped[1]?.generation?.usage).toBeUndefined()
  })

  it('inserts, replaces and removes messages immutably', () => {
    const firstMessage = {
      id: 'user-1',
      role: 'user' as const,
      text: '问题',
      status: 'done' as const,
    }
    const initial = {
      ...createInitialConversationState(),
      messages: [firstMessage],
    }
    const inserted = conversationReducer(initial, {
      type: 'insert-message',
      index: 1,
      message: {
        id: 'assistant-1',
        role: 'assistant',
        text: '',
        status: 'pending',
      },
    })
    const replaced = conversationReducer(inserted, {
      type: 'replace-message',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        text: '答案',
        status: 'done',
      },
    })
    const removed = conversationReducer(replaced, {
      type: 'remove-message',
      messageId: 'assistant-1',
    })

    expect(initial.messages).toEqual([firstMessage])
    expect(inserted.messages[1]).toMatchObject({ status: 'pending', text: '' })
    expect(replaced.messages[1]).toMatchObject({ status: 'done', text: '答案' })
    expect(removed.messages).toEqual([firstMessage])
  })

  it('clears the active detail immediately when its conversation is removed', () => {
    const conversation = createConversation('active', '2026-07-31T02:00:00.000Z', [
      { role: 'user', content: '待删除消息' },
    ])
    const selected = conversationReducer(createInitialConversationState(), {
      type: 'select-conversation',
      conversation,
    })
    const removed = conversationReducer(selected, {
      type: 'remove-conversation',
      conversationId: conversation.id,
    })

    expect(removed.currentConversationId).toBeNull()
    expect(removed.currentConversationSummary).toBeUndefined()
    expect(removed.messages).toEqual([])
    expect(removed.conversations).toEqual([])
  })
})
