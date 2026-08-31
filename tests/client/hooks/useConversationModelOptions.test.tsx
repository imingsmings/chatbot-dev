import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useConversationModelOptions } from '../../../client/src/hooks/useConversationModelOptions'
import type {
  ConversationDetail,
  ConversationModelOptions,
  RuntimeInfo,
} from '../../../client/src/types/chat'

const runtime: RuntimeInfo = {
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  storageBackend: 'file',
  endpointConfigured: true,
  apiKeyConfigured: true,
  providers: [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      configured: true,
      endpointConfigured: true,
      apiKeyConfigured: true,
      defaultModel: 'deepseek-v4-flash',
      models: [
        {
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
        },
        {
          provider: 'deepseek',
          id: 'deepseek-v4-pro',
          label: 'DeepSeek V4 Pro',
          capabilities: {
            tools: true,
            reasoning: true,
            reasoningSummary: false,
            reasoningEfforts: ['low', 'medium', 'high', 'max'],
            temperature: true,
            maxOutputTokens: 65536,
          },
        },
      ],
    },
  ],
  defaults: {
    temperature: null,
    maxTokens: null,
    reasoningEnabled: true,
    reasoningEffort: 'max',
  },
}

const flash: ConversationModelOptions = {
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  reasoningEnabled: true,
  reasoningEffort: 'max',
}
const pro: ConversationModelOptions = {
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  reasoningEnabled: true,
  reasoningEffort: 'high',
  temperature: 0.2,
  maxTokens: 4096,
}

function detail(id: string, modelOptions?: ConversationModelOptions): ConversationDetail {
  return {
    id,
    title: id,
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    messageCount: 0,
    messages: [],
    modelOptions,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

describe('useConversationModelOptions', () => {
  it('keeps sending and saving disabled when the server catalog is unavailable', async () => {
    const update = vi.fn()
    const showError = vi.fn().mockResolvedValue(undefined)
    const unavailableRuntime = { ...runtime, providers: [] }
    const { result } = renderHook(() => useConversationModelOptions({
      applyConversationDetail: vi.fn(),
      currentConversationId: 'a',
      currentConversationModelOptions: flash,
      runtime: unavailableRuntime,
      showError,
      updateConversationModelOptions: update,
    }))

    await waitFor(() => expect(result.current.modelOptions).toEqual({}))
    await act(async () => {
      await expect(result.current.saveModelOptions(flash)).resolves.toBe(false)
    })
    expect(update).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalledWith('模型目录不可用，请刷新后重试')
  })

  it('restores details across runtime/detail ordering and conversation switches', async () => {
    const applyConversationDetail = vi.fn()
    const showError = vi.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(
      (props: {
        id: string
        options?: ConversationModelOptions
        runtime: RuntimeInfo | null
      }) => useConversationModelOptions({
        applyConversationDetail,
        currentConversationId: props.id,
        currentConversationModelOptions: props.options,
        runtime: props.runtime,
        showError,
      }),
      { initialProps: { id: 'a', options: pro, runtime: null as RuntimeInfo | null } },
    )

    expect(result.current.modelOptions).toEqual({})
    rerender({ id: 'a', options: pro, runtime })
    await waitFor(() => expect(result.current.modelOptions).toEqual(pro))
    rerender({ id: 'b', options: flash, runtime })
    await waitFor(() => expect(result.current.modelOptions).toEqual(flash))
  })

  it('optimistically saves once, accepts server normalization and blocks rapid repeats', async () => {
    const pending = deferred<ConversationDetail>()
    const update = vi.fn(() => pending.promise)
    const applyConversationDetail = vi.fn()
    const showError = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useConversationModelOptions({
      applyConversationDetail,
      currentConversationId: 'a',
      currentConversationModelOptions: flash,
      runtime,
      showError,
      updateConversationModelOptions: update,
    }))
    await waitFor(() => expect(result.current.modelOptions).toEqual(flash))

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.saveModelOptions(pro)
      second = result.current.saveModelOptions(flash)
    })
    expect(result.current.isModelOptionsSaving).toBe(true)
    expect(result.current.modelOptions).toEqual(pro)
    await expect(second).resolves.toBe(false)
    expect(update).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve(detail('a', { ...pro, reasoningEffort: 'max' }))
      await first
    })
    expect(result.current.isModelOptionsSaving).toBe(false)
    expect(result.current.modelOptions).toEqual({ ...pro, reasoningEffort: 'max' })
    expect(applyConversationDetail).toHaveBeenCalledTimes(1)
  })

  it('rolls back failures, recovers on retry and ignores stale responses after switching', async () => {
    const failure = deferred<ConversationDetail>()
    const stale = deferred<ConversationDetail>()
    const update = vi.fn()
      .mockImplementationOnce(() => failure.promise)
      .mockImplementationOnce(() => Promise.resolve(detail('a', pro)))
      .mockImplementationOnce(() => stale.promise)
    const applyConversationDetail = vi.fn()
    const showError = vi.fn().mockResolvedValue(undefined)
    const props = {
      id: 'a',
      options: flash,
    }
    const { result, rerender } = renderHook(
      (current: typeof props) => useConversationModelOptions({
        applyConversationDetail,
        currentConversationId: current.id,
        currentConversationModelOptions: current.options,
        runtime,
        showError,
        updateConversationModelOptions: update,
      }),
      { initialProps: props },
    )
    await waitFor(() => expect(result.current.modelOptions).toEqual(flash))

    let failedSave!: Promise<boolean>
    act(() => {
      failedSave = result.current.saveModelOptions(pro)
    })
    await act(async () => {
      failure.reject(new Error('save failed'))
      await failedSave
    })
    expect(result.current.modelOptions).toEqual(flash)
    expect(showError).toHaveBeenCalledWith('save failed')

    await act(async () => {
      await expect(result.current.saveModelOptions(pro)).resolves.toBe(true)
    })
    expect(result.current.modelOptions).toEqual(pro)

    let staleSave!: Promise<boolean>
    act(() => {
      staleSave = result.current.saveModelOptions(flash)
    })
    rerender({ id: 'b', options: pro })
    await waitFor(() => expect(result.current.modelOptions).toEqual(pro))
    await act(async () => {
      stale.resolve(detail('a', flash))
      await staleSave
    })
    expect(result.current.modelOptions).toEqual(pro)
  })
})
