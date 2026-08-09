import { describe, expect, it } from 'vitest'

import {
  DEEPSEEK_MODELS,
  MAX_MODEL_TOKENS,
  getInitialModelOptions,
  getModelDescriptor,
  normalizeDeepSeekModelId,
  parseModelSettingsDraft,
  selectModelOptions,
} from '../../../client/src/utils/modelOptions'
import type { RuntimeInfo } from '../../../client/src/types/chat'
import { promptTemplates, renderPromptTemplate } from '../../../client/src/utils/promptTemplates'
import { settleRunningToolActivities } from '../../../client/src/utils/toolActivities'
import {
  formatModelName,
  formatProviderName,
  formatReasoningEffort,
  formatStorageBackend,
} from '../../../client/src/utils/displayNames'

describe('framework-neutral core logic', () => {
  const runtime: RuntimeInfo = {
    provider: 'openai',
    model: 'gpt-5.6-luna',
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
      },
      {
        id: 'openai',
        label: 'OpenAI',
        configured: true,
        endpointConfigured: true,
        apiKeyConfigured: true,
        defaultModel: 'gpt-5.6-luna',
        models: [{
          provider: 'openai',
          id: 'gpt-5.6-sol',
          label: 'GPT-5.6 Sol',
          disabled: true,
          capabilities: {
            tools: true,
            reasoning: true,
            reasoningSummary: true,
            reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
            temperature: false,
            maxOutputTokens: 128000,
          },
        }, {
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
      },
    ],
    defaults: {
      temperature: 0.7,
      maxTokens: 100000,
      reasoningEnabled: true,
      reasoningEffort: 'xhigh',
    },
  }

  it('formats internal model identifiers as standard display names', () => {
    expect(formatProviderName('deepseek')).toBe('DeepSeek')
    expect(formatProviderName('openai')).toBe('OpenAI')
    expect(formatModelName('deepseek-v4-flash')).toBe('DeepSeek V4 Flash')
    expect(formatModelName('gpt-5.6-luna')).toBe('GPT-5.6 Luna')
    expect(formatReasoningEffort('xhigh')).toBe('Extra High')
    expect(formatReasoningEffort('max')).toBe('Max')
    expect(formatStorageBackend('sqlite')).toBe('SQLite')
    expect(formatStorageBackend('file')).toBe('File')
  })

  it('preserves model settings validation', () => {
    expect(
      parseModelSettingsDraft({
        temperature: '0.3',
        maxTokens: '2048',
        reasoningEnabled: true,
        reasoningEffort: 'high',
      }),
    ).toEqual({
      temperature: 0.3,
      maxTokens: 2048,
      reasoningEnabled: true,
      reasoningEffort: 'high',
    })

    expect(() =>
      parseModelSettingsDraft({
        temperature: '2.1',
        maxTokens: '2048',
        reasoningEnabled: true,
        reasoningEffort: 'high',
      }),
    ).toThrow(/Temperature/)
    expect(() =>
      parseModelSettingsDraft({
        temperature: '0.3',
        maxTokens: `${MAX_MODEL_TOKENS + 1}`,
        reasoningEnabled: true,
        reasoningEffort: 'high',
      }),
    ).toThrow(/Max Tokens/)
  })

  it('exposes only the official DeepSeek V4 model ids', () => {
    expect(DEEPSEEK_MODELS).toEqual([
      { label: 'DeepSeek V4 Flash', value: 'deepseek-v4-flash' },
      { label: 'DeepSeek V4 Pro', value: 'deepseek-v4-pro' },
    ])
    expect(normalizeDeepSeekModelId('deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(normalizeDeepSeekModelId('deepseek-reasoner')).toBe('deepseek-v4-flash')
  })

  it('uses runtime model capabilities for OpenAI defaults and provider switches', () => {
    expect(getInitialModelOptions(runtime)).toEqual({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      temperature: undefined,
      maxTokens: 100000,
      reasoningEnabled: true,
      reasoningEffort: 'xhigh',
    })

    const openai = getModelDescriptor(runtime, {
      provider: 'openai',
      model: 'gpt-5.6-luna',
    })
    expect(selectModelOptions({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      temperature: 0.7,
      maxTokens: 65536,
      reasoningEnabled: true,
      reasoningEffort: 'max',
    }, openai)).toEqual({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      temperature: undefined,
      maxTokens: 65536,
      reasoningEnabled: true,
      reasoningEffort: 'max',
    })

    expect(() => parseModelSettingsDraft({
      temperature: '0.3',
      maxTokens: '2048',
      reasoningEnabled: true,
      reasoningEffort: 'high',
    }, openai)).toThrow(/does not support Temperature/)

    expect(getModelDescriptor(runtime, {
      provider: 'openai',
      model: 'gpt-5.6-sol',
    }).id).toBe('gpt-5.6-luna')
  })

  it('falls back to a usable catalog when runtime providers contain no models', () => {
    const malformedRuntime: RuntimeInfo = {
      ...runtime,
      provider: 'deepseek',
      model: null,
      providers: [{
        id: 'deepseek',
        label: 'DeepSeek',
        configured: false,
        endpointConfigured: false,
        apiKeyConfigured: false,
        defaultModel: 'deepseek-v4-flash',
        models: [],
      }],
    }

    expect(getInitialModelOptions(malformedRuntime)).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    })
    expect(getModelDescriptor(malformedRuntime, {}).id).toBe('deepseek-v4-flash')

    const nullModelRuntime = {
      ...malformedRuntime,
      providers: [{ ...malformedRuntime.providers![0], models: [null] }],
    } as unknown as RuntimeInfo
    expect(getModelDescriptor(nullModelRuntime, {}).id).toBe('deepseek-v4-flash')
  })

  it('preserves the six prompt templates and repeated variable replacement', () => {
    expect(promptTemplates.map((template) => template.name)).toEqual([
      '代码解释',
      'Bug 分析',
      '技术方案评审',
      '翻译润色',
      '周报总结',
      '学习计划',
    ])

    expect(
      renderPromptTemplate(
        {
          id: 'repeat',
          name: 'Repeat',
          content: '{topic} -> {topic}: {code}',
          variables: [],
        },
        { topic: 'streaming', code: 'fetch()' },
      ),
    ).toBe('streaming -> streaming: fetch()')
  })

  it('settles only running tools without mutating the source array', () => {
    const activities = [
      { id: 'running', name: 'getWeather', status: 'running' as const },
      { id: 'done', name: 'calculate', status: 'success' as const, summary: '42' },
    ]

    const settled = settleRunningToolActivities(activities, 'stopped', '已停止')

    expect(settled).toEqual([
      { id: 'running', name: 'getWeather', status: 'stopped', summary: '已停止' },
      activities[1],
    ])
    expect(activities[0].status).toBe('running')
    expect(settleRunningToolActivities(undefined, 'error', '执行中断')).toEqual([])
  })
})
