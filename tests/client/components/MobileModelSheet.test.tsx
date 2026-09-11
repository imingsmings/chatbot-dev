import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { MobileModelSheet } from '../../../client/src/components/MobileModelSheet'
import type { RuntimeInfo } from '../../../client/src/types/chat'

const capabilities = { tools: true, reasoning: true, reasoningSummary: false, reasoningEfforts: ['low', 'medium', 'high', 'max'], temperature: true, maxOutputTokens: 65536 }
const runtime: RuntimeInfo = {
  provider: 'deepseek', model: 'flash', storageBackend: 'file', endpointConfigured: true, apiKeyConfigured: true,
  providers: [
    { id: 'deepseek', label: 'DeepSeek', configured: true, endpointConfigured: true, apiKeyConfigured: true, defaultModel: 'flash', models: [
      { id: 'flash', provider: 'deepseek', label: 'DeepSeek Flash', capabilities },
      { id: 'vision', provider: 'deepseek', label: 'DeepSeek Vision', capabilities: { ...capabilities, inputModalities: ['text', 'image'] } },
      { id: 'disabled', provider: 'deepseek', label: 'Disabled Model', disabled: true, capabilities },
    ] },
    { id: 'openai', label: 'OpenAI', configured: false, endpointConfigured: true, apiKeyConfigured: false, defaultModel: 'other', models: [
      { id: 'other', provider: 'openai', label: 'Unconfigured Model', capabilities },
    ] },
  ],
  defaults: { temperature: null, maxTokens: null, reasoningEnabled: true, reasoningEffort: 'high' },
}

function props(overrides: Partial<ComponentProps<typeof MobileModelSheet>> = {}): ComponentProps<typeof MobileModelSheet> {
  return { disabled: false, saving: false, open: true, options: { provider: 'deepseek', model: 'flash', reasoningEnabled: true, reasoningEffort: 'high' }, runtime, onChange: vi.fn(), onOpenChange: vi.fn(), ...overrides }
}

describe('MobileModelSheet', () => {
  it('shows one dialog with grouped models, unique selection and explicit unavailable states', () => {
    const input = props()
    render(<MobileModelSheet {...input} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'DeepSeek' })).toBeInTheDocument()
    const models = screen.getByRole('radiogroup', { name: '模型' })
    expect(within(models).getAllByRole('radio', { checked: true })).toHaveLength(1)
    expect(screen.getByRole('radio', { name: '选择 DeepSeek Flash' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '选择 Disabled Model' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: '选择 Unconfigured Model' })).toBeDisabled()
    expect(screen.getByText('不可用')).toBeVisible()
    expect(screen.getByText('未配置')).toBeVisible()
    screen.getByRole('radio', { name: '选择 Disabled Model' }).click()
    expect(input.onChange).not.toHaveBeenCalled()
  })

  it('keeps the sheet open while selecting models and preserves effort request values', () => {
    const input = props()
    render(<MobileModelSheet {...input} />)
    fireEvent.click(screen.getByRole('radio', { name: '选择 DeepSeek Vision' }))
    expect(input.onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: 'deepseek', model: 'vision' }))
    fireEvent.click(screen.getByRole('radio', { name: '思考强度 最高' }))
    expect(input.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ reasoningEnabled: true, reasoningEffort: 'max' }))
    fireEvent.click(screen.getByRole('radio', { name: '思考强度 关闭' }))
    expect(input.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ reasoningEnabled: false, reasoningEffort: 'high' }))
    expect(input.onOpenChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '关闭模型选择' }))
    expect(input.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('blocks changes during save but keeps closing available', () => {
    const input = props({ disabled: true, saving: true })
    render(<MobileModelSheet {...input} />)
    expect(screen.getByText('保存中...')).toBeVisible()
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByLabelText('选择模型：DeepSeek Flash')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: '关闭模型选择' })).toBeEnabled()
  })

  it('fails closed without the catalog and hides reasoning for unsupported models', () => {
    const input = props({ runtime: null })
    const view = render(<MobileModelSheet {...input} />)
    expect(screen.getByRole('button', { name: '模型目录不可用' })).toBeDisabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(<MobileModelSheet {...props({ runtime: { ...runtime, providers: runtime.providers!.map(provider => ({ ...provider, models: provider.models.map(model => ({ ...model, capabilities: { ...model.capabilities, reasoning: false } })) })) } })} />)
    expect(screen.queryByRole('group', { name: '思考强度' })).not.toBeInTheDocument()
  })
})
