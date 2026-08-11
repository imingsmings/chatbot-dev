import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AppActionsMenu } from '../../../client/src/components/AppActionsMenu'

describe('AppActionsMenu', () => {
  it('keeps model parameters available while disabling an unavailable summary', () => {
    render(
      <AppActionsMenu
        canGenerateSummary={false}
        canPreviewContext={false}
        disabled={false}
        isContextPreviewLoading={false}
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onOpenSettings={vi.fn<() => void>()}
        onOpenSummary={vi.fn<() => void>()}
        onOpenTemplates={vi.fn<() => void>()}
        onPreviewContext={vi.fn<() => void>()}
        open
      />,
    )

    expect(screen.getByRole('menuitem', { name: '参数' })).toHaveAttribute(
      'aria-disabled',
      'false',
    )
    expect(screen.getByRole('menuitem', { name: '摘要' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
