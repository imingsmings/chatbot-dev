import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useMessageBranching } from '../../../client/src/hooks/useMessageBranching'
import type { ConversationDetail } from '../../../client/src/types/chat'

type MessageBranchingOptions = Parameters<typeof useMessageBranching>[0]

function createBranch(): ConversationDetail {
  return {
    id: 'branch-1',
    title: '原会话（分支）',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    messageCount: 2,
    messages: [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
    ],
  }
}

function createOptions(
  overrides: Partial<MessageBranchingOptions> = {},
): MessageBranchingOptions {
  return {
    beginSidebarOperation: vi.fn(() => true),
    clearSearch: vi.fn(),
    createBranchConversation: vi.fn().mockResolvedValue(createBranch()),
    currentConversationId: 'source-1',
    isResponding: false,
    isStopping: false,
    messages: [
      { id: 'user-1', role: 'user', status: 'done', text: '第一问' },
      { id: 'assistant-1', role: 'assistant', status: 'done', text: '第一答' },
      { id: 'user-2', role: 'user', status: 'done', text: '原问题' },
      { id: 'assistant-2', role: 'assistant', status: 'done', text: '原回答' },
    ],
    promptText: vi.fn().mockResolvedValue('编辑后的问题'),
    resetInput: vi.fn(),
    setOperation: vi.fn(),
    settleConversationView: vi.fn().mockResolvedValue(undefined),
    showError: vi.fn().mockResolvedValue(undefined),
    submitQuestion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useMessageBranching', () => {
  it('edits a persisted user message by selecting a new branch and submitting there', async () => {
    const options = createOptions()
    const { result } = renderHook(() => useMessageBranching(options))

    await act(async () => {
      await result.current.handleEditMessage(2)
    })

    expect(options.promptText).toHaveBeenCalledWith({
      fieldLabel: '用户消息',
      initialValue: '原问题',
      message: '保存后会创建新会话分支并重新生成，原会话保持不变。',
      multiline: true,
      title: '编辑消息并创建分支',
    })
    expect(options.createBranchConversation).toHaveBeenCalledWith(
      'source-1',
      2,
      '编辑后的问题',
    )
    expect(options.submitQuestion).toHaveBeenCalledWith('编辑后的问题', {
      appendUser: true,
      clearComposer: false,
      conversationId: 'branch-1',
    })
    expect(options.clearSearch).toHaveBeenCalledOnce()
    expect(options.resetInput).toHaveBeenCalledOnce()
    expect(options.setOperation).toHaveBeenLastCalledWith(null)
  })

  it('does not create a branch when editing is cancelled or unchanged', async () => {
    const options = createOptions({
      promptText: vi.fn().mockResolvedValue('原问题'),
    })
    const { result } = renderHook(() => useMessageBranching(options))

    await act(async () => {
      await result.current.handleEditMessage(2)
    })

    expect(options.createBranchConversation).not.toHaveBeenCalled()
    expect(options.submitQuestion).not.toHaveBeenCalled()
    expect(options.setOperation).toHaveBeenCalledWith(null)
  })

  it('regenerates from the nearest preceding user message in a new branch', async () => {
    const options = createOptions()
    const { result } = renderHook(() => useMessageBranching(options))

    await act(async () => {
      await result.current.handleRegenerateMessage(3)
    })

    expect(options.promptText).not.toHaveBeenCalled()
    expect(options.createBranchConversation).toHaveBeenCalledWith(
      'source-1',
      2,
      '原问题',
    )
    expect(options.submitQuestion).toHaveBeenCalledWith('原问题', {
      appendUser: true,
      clearComposer: false,
      conversationId: 'branch-1',
    })
  })

  it('keeps the source view recoverable when branch creation fails', async () => {
    const error = new Error('branch failed')
    const options = createOptions({
      createBranchConversation: vi.fn().mockRejectedValue(error),
    })
    const { result } = renderHook(() => useMessageBranching(options))

    await act(async () => {
      await result.current.handleRegenerateMessage(3)
    })

    expect(options.submitQuestion).not.toHaveBeenCalled()
    expect(options.clearSearch).not.toHaveBeenCalled()
    expect(options.showError).toHaveBeenCalledWith('branch failed', '创建分支失败')
    expect(options.setOperation).toHaveBeenLastCalledWith(null)
  })
})
