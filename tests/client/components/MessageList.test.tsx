import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageList } from '../../../client/src/components/MessageList'

describe('MessageList', () => {
  it('shows only implemented actions for a completed assistant message', () => {
    render(
      <MessageList
        copiedMessageId={null}
        isResponding={false}
        messages={[{
          id: 'assistant-done',
          role: 'assistant',
          status: 'done',
          text: 'Completed answer',
        }]}
        onCopyMessage={vi.fn()}
        onRetryMessage={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '复制回答' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '赞同回答' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '不赞同回答' })).not.toBeInTheDocument()
  })

  it('shows persisted generation diagnostics on demand and keeps missing usage unknown', () => {
    render(
      <MessageList
        copiedMessageId={null}
        isResponding={false}
        messages={[{
          id: 'assistant-metadata',
          role: 'assistant',
          status: 'stopped',
          text: 'Partial answer',
          generation: {
            provider: 'deepseek',
            model: 'deepseek-v4-pro',
            firstTokenLatencyMs: 20,
            totalDurationMs: 120,
          },
          toolActivities: [{
            id: 'tool-1',
            name: 'calculate',
            status: 'success',
            summary: '计算结果：42',
            durationMs: 2,
          }],
        }]}
        onCopyMessage={vi.fn()}
        onRetryMessage={vi.fn()}
      />,
    )

    expect(screen.getByText('已停止生成')).toBeInTheDocument()
    expect(screen.getByText('计算结果：42 · 2ms')).toBeInTheDocument()
    expect(screen.getByText('生成详情')).toBeInTheDocument()
    expect(screen.getByText('DeepSeek')).toBeInTheDocument()
    expect(screen.getByText('DeepSeek V4 Pro')).toBeInTheDocument()
    expect(screen.getAllByText('未知')).toHaveLength(6)
  })
})
