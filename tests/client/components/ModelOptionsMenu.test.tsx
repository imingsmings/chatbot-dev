import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ModelOptionsMenu } from '../../../client/src/components/ModelOptionsMenu'
import type { ModelRequestOptions, RuntimeInfo } from '../../../client/src/types/chat'

const runtime: RuntimeInfo = {
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  storageBackend: 'file',
  endpointConfigured: true,
  apiKeyConfigured: true,
  providers: [{
    id: 'deepseek',
    label: 'DeepSeek',
    configured: true,
    endpointConfigured: true,
    apiKeyConfigured: true,
    defaultModel: 'deepseek-v4-flash',
    models: [{
      provider: 'deepseek',
      id: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      capabilities: {
        tools: true,
        reasoning: true,
        reasoningSummary: false,
        reasoningEfforts: ['low', 'medium', 'high', 'max'],
        temperature: true,
        maxOutputTokens: 65536,
      },
    }],
  }],
  defaults: {
    temperature: null,
    maxTokens: null,
    reasoningEnabled: true,
    reasoningEffort: 'high',
  },
}

describe('ModelOptionsMenu', () => {
  it('does not invent a static model when the runtime catalog is unavailable', () => {
    render(
      <ModelOptionsMenu
        disabled={false}
        onChange={vi.fn<(options: ModelRequestOptions) => void>()}
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onEffortOpenChange={vi.fn<(open: boolean) => void>()}
        effortOpen={false}
        open={false}
        options={{}}
        runtime={null}
      />,
    )

    expect(screen.getByRole('button', { name: '模型目录不可用' })).toBeDisabled()
    expect(screen.getByText('模型不可用')).toBeInTheDocument()
    expect(screen.queryByText('DeepSeek V4 Flash')).not.toBeInTheDocument()
  })

  it('uses Effort labels while preserving the reasoningEffort request value', async () => {
    const onChange = vi.fn<(options: ModelRequestOptions) => void>()

    render(
      <ModelOptionsMenu
        disabled={false}
        onChange={onChange}
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onEffortOpenChange={vi.fn<(open: boolean) => void>()}
        effortOpen
        open={false}
        options={{
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          reasoningEnabled: true,
          reasoningEffort: 'high',
        }}
        runtime={runtime}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: '选择模型：DeepSeek V4 Flash',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '思考强度：高' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: '思考强度 高' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '思考强度 最高' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      reasoningEnabled: true,
      reasoningEffort: 'max',
    }))
  })

  it('shows grouped models directly and keeps unavailable options disabled', () => {
    const onChange = vi.fn()
    const configured = runtime.providers![0]
    const base = configured.models[0]
    render(<ModelOptionsMenu disabled={false} effortOpen={false} onEffortOpenChange={vi.fn()} onChange={onChange} onOpenChange={vi.fn()} open options={{ provider: base.provider, model: base.id }} runtime={{ ...runtime, providers: [{ ...configured, models: [base, { ...base, id: 'disabled', label: 'Disabled Model', disabled: true }] }] }} />)
    expect(screen.getByRole('group', { name: 'DeepSeek' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: '选择 DeepSeek V4 Flash' })).toHaveAttribute('aria-checked', 'true')
    const disabled = screen.getByRole('menuitemradio', { name: '选择 Disabled Model' })
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
    expect(disabled).toHaveTextContent('不可用')
    fireEvent.click(disabled)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hides effort selection for models without reasoning support', () => {
    const provider = runtime.providers![0]
    render(<ModelOptionsMenu disabled={false} effortOpen={false} onEffortOpenChange={vi.fn()} onChange={vi.fn()} onOpenChange={vi.fn()} open={false} options={{}} runtime={{ ...runtime, providers: [{ ...provider, models: provider.models.map(model => ({ ...model, capabilities: { ...model.capabilities, reasoning: false } })) }] }} />)
    expect(screen.queryByRole('button', { name: /思考强度/ })).not.toBeInTheDocument()
  })
})
