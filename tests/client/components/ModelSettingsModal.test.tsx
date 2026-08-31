import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ModelSettingsModal } from '../../../client/src/components/ModelSettingsModal'
import type { ModelRequestOptions, RuntimeInfo } from '../../../client/src/types/chat'

const runtime: RuntimeInfo = {
  provider: 'openai',
  model: 'gpt-5.6-luna',
  storageBackend: 'file',
  endpointConfigured: true,
  apiKeyConfigured: true,
  providers: [{
    id: 'openai',
    label: 'OpenAI',
    configured: true,
    endpointConfigured: true,
    apiKeyConfigured: true,
    defaultModel: 'gpt-5.6-luna',
    models: [{
      provider: 'openai',
      id: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      capabilities: {
        tools: true,
        reasoning: true,
        reasoningSummary: true,
        reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        temperature: false,
        maxOutputTokens: 128000,
      },
    }],
  }],
  defaults: {
    temperature: null,
    maxTokens: null,
    reasoningEnabled: true,
    reasoningEffort: 'medium',
  },
}

const deepSeekRuntime: RuntimeInfo = {
  ...runtime,
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
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
}

describe('ModelSettingsModal', () => {
  it('keeps settings safe when the runtime catalog is unavailable', () => {
    const onSave = vi.fn<(options: ModelRequestOptions) => void>()
    render(
      <ModelSettingsModal
        onClose={vi.fn<() => void>()}
        onSave={onSave}
        open
        options={{}}
        runtime={null}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Model catalog is unavailable')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('disables repeated apply while the conversation options are saving', () => {
    render(
      <ModelSettingsModal
        onClose={vi.fn<() => void>()}
        onSave={vi.fn<(options: ModelRequestOptions) => void>()}
        open
        options={{
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          reasoningEnabled: true,
          reasoningEffort: 'medium',
        }}
        runtime={deepSeekRuntime}
        saving
      />,
    )

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
  })

  it('renders controls from OpenAI model capabilities and enforces its output limit', () => {
    const onSave = vi.fn<(options: ModelRequestOptions) => void>()
    render(
      <ModelSettingsModal
        onClose={vi.fn<() => void>()}
        onSave={onSave}
        open
        options={{
          provider: 'openai',
          model: 'gpt-5.6-luna',
          reasoningEnabled: true,
          reasoningEffort: 'xhigh',
        }}
        runtime={runtime}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Model Parameters' })).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('GPT-5.6 Luna')).toBeInTheDocument()
    expect(screen.getByText('File')).toBeInTheDocument()
    expect(screen.queryByLabelText('Temperature')).not.toBeInTheDocument()
    const maxTokens = screen.getByLabelText('Max Tokens')
    expect(maxTokens).toHaveAttribute('max', '128000')
    expect(screen.getByLabelText('OpenAI Effort')).toHaveValue('xhigh')
    expect(screen.getByRole('option', { name: 'Extra High' })).toBeInTheDocument()

    fireEvent.change(maxTokens, { target: { value: '128001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getByRole('alert')).toHaveTextContent('128000')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('renders standard DeepSeek parameter names and display values', () => {
    render(
      <ModelSettingsModal
        onClose={vi.fn<() => void>()}
        onSave={vi.fn<(options: ModelRequestOptions) => void>()}
        open
        options={{
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          reasoningEnabled: true,
          reasoningEffort: 'max',
        }}
        runtime={deepSeekRuntime}
      />,
    )

    expect(screen.getByText('DeepSeek V4 Flash')).toBeInTheDocument()
    expect(screen.queryByText('deepseek-v4-flash')).not.toBeInTheDocument()
    expect(screen.getByText('File')).toBeInTheDocument()
    expect(screen.getByLabelText('Temperature')).toHaveAttribute(
      'placeholder',
      'Provider Default',
    )
    expect(screen.getByLabelText('Max Tokens')).toHaveAttribute(
      'placeholder',
      'Provider Default',
    )
    expect(screen.getByLabelText('Enable Reasoning')).toBeChecked()
    expect(screen.getByLabelText('DeepSeek Effort')).toHaveValue('max')
    expect(screen.getByRole('option', { name: 'Max' })).toBeInTheDocument()
  })
})
