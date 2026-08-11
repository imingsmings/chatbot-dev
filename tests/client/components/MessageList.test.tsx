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
})
