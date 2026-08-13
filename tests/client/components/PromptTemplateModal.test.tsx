import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PromptTemplateModal } from '../../../client/src/components/PromptTemplateModal'

describe('PromptTemplateModal', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('creates a custom template, derives fields, applies it, and restores it after remount', () => {
    const onApply = vi.fn<(prompt: string) => void>()
    const first = render(<PromptTemplateModal onApply={onApply} onClose={vi.fn()} open />)

    fireEvent.click(screen.getByRole('button', { name: '新建模板' }))
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '自定义分析' } })
    fireEvent.change(screen.getByLabelText('模板内容'), {
      target: { value: '请分析 {主题}：\n\n{内容}' },
    })
    expect(screen.getByText(/\{主题\}、\{内容\}/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))

    expect(screen.getByText('自定义模板已创建')).toBeInTheDocument()
    expect(screen.getByText('自定义模板 · 保存在当前浏览器')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('主题'), { target: { value: 'NDJSON' } })
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '验证流式边界' } })
    fireEvent.click(screen.getByRole('button', { name: '填入输入框' }))
    expect(onApply).toHaveBeenCalledWith('请分析 NDJSON：\n\n验证流式边界')

    first.unmount()
    render(<PromptTemplateModal onApply={vi.fn()} onClose={vi.fn()} open />)
    expect(screen.getByRole('button', { name: '自定义分析' })).toBeInTheDocument()
  })

  it('edits and requires a second explicit click before deleting a custom template', () => {
    render(<PromptTemplateModal onApply={vi.fn()} onClose={vi.fn()} open />)
    fireEvent.click(screen.getByRole('button', { name: '新建模板' }))
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '待编辑' } })
    fireEvent.change(screen.getByLabelText('模板内容'), { target: { value: '原内容' } })
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))

    fireEvent.click(screen.getByRole('button', { name: '编辑自定义模板' }))
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '编辑完成' } })
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))
    expect(screen.getByRole('button', { name: '编辑完成' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除自定义模板' }))
    expect(screen.getByRole('button', { name: '确认删除自定义模板' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑完成' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认删除自定义模板' }))
    expect(screen.queryByRole('button', { name: '编辑完成' })).not.toBeInTheDocument()
  })
})
