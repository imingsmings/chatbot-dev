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
        onOpenSettings={vi.fn<() => void>()}
        open={false}
        options={{}}
        runtime={null}
      />,
    )

    expect(screen.getByRole('button', { name: 'Model catalog unavailable' })).toBeDisabled()
    expect(screen.getByText('Model unavailable')).toBeInTheDocument()
    expect(screen.queryByText('DeepSeek V4 Flash')).not.toBeInTheDocument()
  })

  it('uses Effort labels while preserving the reasoningEffort request value', async () => {
    const onChange = vi.fn<(options: ModelRequestOptions) => void>()

    render(
      <ModelOptionsMenu
        disabled={false}
        onChange={onChange}
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onOpenSettings={vi.fn<() => void>()}
        open
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
        name: 'Model and Effort: DeepSeek V4 Flash, High',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Select Effort' })).toHaveTextContent('Effort')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Select Effort' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Select Effort Max' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      reasoningEnabled: true,
      reasoningEffort: 'max',
    }))
  })
})
