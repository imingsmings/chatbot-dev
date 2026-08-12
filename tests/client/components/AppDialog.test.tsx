import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AppDialog } from '../../../client/src/components/AppDialog'
import type { DialogState } from '../../../client/src/hooks/useAppDialog'

const multilineDialog: DialogState = {
  cancelLabel: '取消',
  confirmLabel: '保存',
  danger: false,
  fieldLabel: '用户消息',
  initialValue: '原问题',
  message: '保存后创建分支',
  mode: 'prompt',
  multiline: true,
  open: true,
  title: '编辑消息并创建分支',
}

describe('AppDialog', () => {
  it('renders a multiline prompt and confirms it with Ctrl+Enter', () => {
    const onConfirm = vi.fn()
    render(
      <AppDialog
        dialog={multilineDialog}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    const input = screen.getByLabelText('用户消息')
    expect(input.tagName).toBe('TEXTAREA')
    fireEvent.change(input, { target: { value: '编辑后的\n问题' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })

    expect(onConfirm).toHaveBeenCalledWith('编辑后的\n问题')
  })
})
