import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ContextDebugModal } from '../../../client/src/components/ContextDebugModal'
import type { ContextPreview } from '../../../client/src/types/chat'

const context: ContextPreview = {
  conversationId: 'context-preview-test',
  question: '当前问题',
  messages: [
    { role: 'system', content: 'system' },
    { role: 'user', content: '当前问题' },
  ],
  stats: {
    totalHistoryMessages: 5,
    summaryCoveredMessages: 2,
    postSummaryMessages: 3,
    excludedStoppedMessages: 0,
    selectedHistoryMessages: 2,
    droppedHistoryMessages: 1,
    selectedHistoryChars: 120,
    selectedHistoryRange: { start: 4, end: 5 },
    maxHistoryMessages: 20,
    maxHistoryChars: 12000,
    maxImages: 4,
    selectedImages: 1,
    droppedImages: 1,
    selectedImageBytes: 1024,
    summaryIncluded: false,
    summaryDroppedByTokenBudget: true,
    legacyDroppedHistoryMessages: 0,
    tokenDroppedHistoryMessages: 1,
    estimatedInputTokens: 5200,
    outputReserveTokens: 4096,
    estimatedTotalTokens: 9296,
    contextWindowTokens: 131072,
    remainingInputTokens: 121776,
    estimator: 'deepseek-utf8-conservative-v1',
    tokenBreakdown: {
      system: 84,
      summary: 0,
      history: 1200,
      currentQuestion: 64,
      images: 896,
      tools: 900,
      framing: 32,
      toolContinuationReserve: 2024,
    },
  },
  model: {
    provider: 'deepseek',
    model: 'deepseek-v4-flash-vision-exp',
    endpointConfigured: true,
    apiKeyConfigured: true,
    reasoningEnabled: true,
    reasoningEffort: 'max',
    stream: true,
    toolChoice: 'auto',
    storageBackend: 'file',
    temperature: null,
    maxTokens: 4096,
    contextWindowTokens: 131072,
  },
  tools: {
    count: 3,
    definitions: [],
  },
}

describe('ContextDebugModal', () => {
  it('renders the provider-aware budget, trim reason and component breakdown', () => {
    render(<ContextDebugModal context={context} onClose={vi.fn()} open />)

    expect(screen.getByRole('dialog')).toHaveTextContent('5200/126976')
    expect(screen.getByRole('dialog')).toHaveTextContent('9296/131072')
    expect(screen.getByRole('dialog')).toHaveTextContent('预算不足，已排除')
    fireEvent.click(screen.getByText('预算明细'))
    expect(screen.getByRole('region', { name: 'Token Budget Breakdown' })).toHaveTextContent('图片')
    expect(screen.getByRole('region', { name: 'Token Budget Breakdown' })).toHaveTextContent('896')
    expect(screen.getByRole('dialog')).toHaveTextContent('deepseek-utf8-conservative-v1')
  })

  it('renders an inline inspector without a modal and keeps raw requests collapsed', () => {
    const { container } = render(<ContextDebugModal context={context} onClose={vi.fn()} open modal={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '上下文' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '原始请求' }))
    const messages = screen.getByText('发送给模型的消息 · 2').closest('details')
    expect(messages).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('发送给模型的消息 · 2'))
    expect(container.querySelectorAll('.context-message-item')).toHaveLength(2)
    expect(screen.getByText('工具定义 · 3').closest('details')).not.toHaveAttribute('open')
  })
})
