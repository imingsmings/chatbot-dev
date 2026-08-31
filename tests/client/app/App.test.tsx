import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../../client/src/app/App'

const conversation = {
  id: 'react-app-test',
  title: 'React 会话',
  createdAt: '2026-07-31T10:00:00.000Z',
  updatedAt: '2026-07-31T10:00:00.000Z',
  messageCount: 0,
  messages: [],
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('React chat app shell', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('initializes the current conversation and enables the migrated composer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        if (url.endsWith('/api/runtime-config')) {
          return jsonResponse({
            runtime: {
              profile: {
                name: 'Jason Wang',
                avatarUrl: '/assets/jw.svg',
              },
              provider: 'deepseek',
              model: 'deepseek-v4-pro',
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
                  defaultModel: 'deepseek-v4-pro',
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
                reasoningEffort: 'high',
              },
            },
          })
        }
        if (url === '/api/conversations') {
          return jsonResponse({ conversations: [conversation] })
        }
        if (url.endsWith('/api/conversations/react-app-test')) {
          return jsonResponse({ conversation })
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'React 会话' })).toBeInTheDocument()
    })
    expect(screen.getByRole('navigation', { name: '会话' })).toHaveTextContent('React 会话')
    expect(screen.getByText('Jason Wang')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Jason Wang 的头像' })).toHaveAttribute(
      'src',
      '/assets/jw.svg',
    )
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask AI')).toBeEnabled()
    })
    expect(
      screen.getByRole('button', {
        name: 'Model and Effort: DeepSeek V4 Pro, High',
      }),
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '添加和工具' }))
    expect(await screen.findByRole('menuitem', { name: '摘要' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('reuses the current default empty conversation when new chat is clicked repeatedly', async () => {
    const blankConversation = {
      ...conversation,
      id: 'default-empty-conversation',
      title: '新的聊天',
    }
    let createRequestCount = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        const method = (input instanceof Request ? input.method : init?.method) ?? 'GET'

        if (url.endsWith('/api/runtime-config')) {
          return jsonResponse({
            runtime: {
              profile: {
                name: 'Jason Wang',
                avatarUrl: '/assets/jw.svg',
              },
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              storageBackend: 'file',
              endpointConfigured: true,
              apiKeyConfigured: true,
              defaults: {
                temperature: null,
                maxTokens: null,
                reasoningEnabled: true,
                reasoningEffort: 'high',
              },
            },
          })
        }
        if (url === '/api/conversations' && method === 'GET') {
          return jsonResponse({ conversations: [blankConversation] })
        }
        if (url.endsWith('/api/conversations/default-empty-conversation')) {
          return jsonResponse({ conversation: blankConversation })
        }
        if (url === '/api/conversations' && method === 'POST') {
          createRequestCount += 1
          return jsonResponse({
            conversation: {
              ...blankConversation,
              id: `unexpected-empty-conversation-${createRequestCount}`,
            },
          })
        }
        throw new Error(`Unexpected request: ${method} ${url}`)
      }),
    )

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '新的聊天' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Model catalog unavailable' })).toBeDisabled()
    expect(screen.queryByText('DeepSeek V4 Flash')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByPlaceholderText('Ask AI')).toBeEnabled())
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
    const newChatButton = screen.getByRole('button', { name: '新建会话' })
    await waitFor(() => expect(newChatButton).toBeEnabled())

    fireEvent.click(newChatButton)
    await waitFor(() => expect(newChatButton).toBeEnabled())
    fireEvent.click(newChatButton)
    fireEvent.click(newChatButton)
    fireEvent.click(newChatButton)
    await waitFor(() => expect(newChatButton).toBeEnabled())

    expect(createRequestCount).toBe(0)
    expect(
      screen.getByRole('navigation', { name: '会话' }).querySelectorAll('.conversation-item-shell'),
    ).toHaveLength(1)
  })
})
