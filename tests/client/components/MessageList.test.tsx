import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MessageList } from '../../../client/src/components/MessageList'

afterEach(() => {
  delete window.__chatbotPerformanceDiagnostics
})

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
        onEditMessage={vi.fn()}
        onRegenerateMessage={vi.fn()}
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
        onEditMessage={vi.fn()}
        onRegenerateMessage={vi.fn()}
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

  it('offers edit and regenerate actions for persisted history', () => {
    const onEditMessage = vi.fn()
    const onRegenerateMessage = vi.fn()

    render(
      <MessageList
        copiedMessageId={null}
        isResponding={false}
        messages={[
          { id: 'user-1', persistedIndex: 0, role: 'user', status: 'done', text: '原问题' },
          { id: 'assistant-1', persistedIndex: 1, role: 'assistant', status: 'done', text: '原回答' },
        ]}
        onCopyMessage={vi.fn()}
        onEditMessage={onEditMessage}
        onRegenerateMessage={onRegenerateMessage}
        onRetryMessage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '编辑消息' }))
    fireEvent.click(screen.getByRole('button', { name: '重新生成回答' }))

    expect(onEditMessage).toHaveBeenCalledWith(0)
    expect(onRegenerateMessage).toHaveBeenCalledWith(1)
  })

  it('keeps failed optimistic questions on the in-place retry path', () => {
    const onRetryMessage = vi.fn()

    render(
      <MessageList
        copiedMessageId={null}
        isResponding={false}
        messages={[
          { id: 'user-1', role: 'user', status: 'done', text: '未保存问题' },
          {
            id: 'assistant-error',
            role: 'assistant',
            status: 'error',
            text: '',
            error: '网络失败',
          },
        ]}
        onCopyMessage={vi.fn()}
        onEditMessage={vi.fn()}
        onRegenerateMessage={vi.fn()}
        onRetryMessage={onRetryMessage}
      />,
    )

    expect(screen.queryByRole('button', { name: '编辑消息' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新生成回答' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetryMessage).toHaveBeenCalledWith(1)
  })

  it('does not rerender unchanged history rows when the streaming row changes', () => {
    window.__chatbotPerformanceDiagnostics = { enabled: true, marks: [] }
    const history = [
      { id: 'user-1', persistedIndex: 0, role: 'user' as const, status: 'done' as const, text: '问题' },
      { id: 'assistant-1', persistedIndex: 1, role: 'assistant' as const, status: 'done' as const, text: '历史回答' },
    ]
    const actions = {
      onCopyMessage: vi.fn(),
      onEditMessage: vi.fn(),
      onRegenerateMessage: vi.fn(),
      onRetryMessage: vi.fn(),
    }
    const { rerender } = render(
      <MessageList
        {...actions}
        copiedMessageId={null}
        isResponding
        messages={[
          ...history,
          { id: 'assistant-stream', role: 'assistant', status: 'streaming', text: 'A' },
        ]}
      />,
    )
    window.__chatbotPerformanceDiagnostics.marks = []

    rerender(
      <MessageList
        copiedMessageId={null}
        isResponding
        messages={[
          ...history,
          { id: 'assistant-stream', role: 'assistant', status: 'streaming', text: 'AB' },
        ]}
        onCopyMessage={vi.fn()}
        onEditMessage={vi.fn()}
        onRegenerateMessage={vi.fn()}
        onRetryMessage={vi.fn()}
      />,
    )

    const renderedMessageIds = window.__chatbotPerformanceDiagnostics.marks
      .filter((mark) => mark.name === 'message-row-render')
      .map((mark) => mark.detail?.messageId)
    expect(renderedMessageIds).toEqual(['assistant-stream'])
  })
})
