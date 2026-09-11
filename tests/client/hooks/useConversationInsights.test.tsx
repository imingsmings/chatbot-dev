import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getConversationContextPreview } from '../../../client/src/api/conversations'
import { useConversationInsights, type ConversationInsightOptions } from '../../../client/src/hooks/useConversationInsights'
import type { ContextPreview } from '../../../client/src/types/chat'

vi.mock('../../../client/src/api/conversations', () => ({
  getConversationContextPreview: vi.fn(), generateConversationSummary: vi.fn(),
}))

const preview = { conversationId: 'a' } as ContextPreview
const fetchPreview = vi.mocked(getConversationContextPreview)
function options(): ConversationInsightOptions {
  return {
    applyConversationDetail: vi.fn(), closeTopMenu: vi.fn(), currentAttachments: [],
    currentConversationId: 'a', hasBlockingUpload: false, input: 'draft',
    isConversationTransitioning: false, isModelOptionsSaving: false,
    modelOptionsAvailable: true, isResponding: false, isStopping: false, messageCount: 2,
    modelOptions: { model: 'model-a', reasoningEffort: 'high' },
    refreshConversationListAndSearch: vi.fn().mockResolvedValue(undefined),
    showError: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => fetchPreview.mockReset().mockResolvedValue(preview))

describe('context inspector snapshot lifecycle', () => {
  it.each<[string, Partial<ConversationInsightOptions>]>([
    ['conversation', { currentConversationId: 'b' }],
    ['draft', { input: 'new draft' }],
    ['model', { modelOptions: { model: 'model-b' } }],
    ['history', { messageCount: 4 }],
    ['streaming', { isResponding: true }],
  ])('closes a snapshot after %s changes', async (_name, change) => {
    const initial = options()
    const { result, rerender } = renderHook(props => useConversationInsights(props), { initialProps: initial })
    await act(() => result.current.openContextPreview())
    expect(result.current.isContextPreviewOpen).toBe(true)
    rerender({ ...initial, ...change })
    expect(result.current.isContextPreviewOpen).toBe(false)
  })

  it('discards a late preview after the draft changes', async () => {
    let resolve!: (value: ContextPreview) => void
    fetchPreview.mockReturnValue(new Promise(r => { resolve = r }))
    const initial = options()
    const { result, rerender } = renderHook(props => useConversationInsights(props), { initialProps: initial })
    let pending!: Promise<void>
    act(() => { pending = result.current.openContextPreview() })
    rerender({ ...initial, input: 'changed while loading' })
    await act(async () => { resolve(preview); await pending })
    expect(result.current.isContextPreviewOpen).toBe(false)
    expect(result.current.contextPreview).toBeNull()
    expect(result.current.isContextPreviewLoading).toBe(false)
  })

  it('does not request a preview while attachments are uploading', async () => {
    const { result } = renderHook(() => useConversationInsights({ ...options(), hasBlockingUpload: true }))
    await act(() => result.current.openContextPreview())
    expect(fetchPreview).not.toHaveBeenCalled()
  })

  it('reports a current failure and allows a subsequent request', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchPreview.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(preview)
    const initial = options()
    const { result } = renderHook(() => useConversationInsights(initial))
    await act(() => result.current.openContextPreview())
    expect(initial.showError).toHaveBeenCalledWith('上下文预览失败，请稍候再试')
    expect(result.current.isContextPreviewLoading).toBe(false)
    await act(() => result.current.openContextPreview())
    expect(result.current.isContextPreviewOpen).toBe(true)
    errorLog.mockRestore()
  })
})
