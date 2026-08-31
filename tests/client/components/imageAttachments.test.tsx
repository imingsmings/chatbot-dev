import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { downloadConversationAttachment } = vi.hoisted(() => ({
  downloadConversationAttachment: vi.fn(),
}))

vi.mock('../../../client/src/api/conversations', () => ({
  downloadConversationAttachment,
}))

import { ChatComposer } from '../../../client/src/components/ChatComposer'
import { MessageAttachments } from '../../../client/src/components/MessageAttachments'
import type { ComposerImageAttachment } from '../../../client/src/hooks/useImageAttachments'
import type { ImageAttachment } from '../../../client/src/types/chat'

function attachment(): ImageAttachment {
  return {
    id: 'att_00000000-0000-4000-8000-000000000001',
    kind: 'image',
    filename: 'preview.png',
    mediaType: 'image/png',
    byteSize: 5,
    width: 1,
    height: 1,
    detail: 'auto',
  }
}

function composerItem(status: ComposerImageAttachment['status']): ComposerImageAttachment {
  return {
    clientId: 'upload-1',
    conversationId: 'conversation-1',
    file: new File(['image'], 'preview.png', { type: 'image/png' }),
    previewUrl: 'blob:preview',
    status,
    ...(status === 'ready' ? { attachment: attachment() } : {}),
    ...(status === 'error' ? { error: '上传失败' } : {}),
  }
}

function renderComposer(overrides: Partial<React.ComponentProps<typeof ChatComposer>> = {}) {
  const props: React.ComponentProps<typeof ChatComposer> = {
    attachments: [],
    canGenerateSummary: false,
    canPreviewContext: false,
    canSubmit: false,
    disabled: false,
    isContextPreviewLoading: false,
    isResponding: false,
    isStopping: false,
    modelMenuOpen: false,
    modelOptions: { provider: 'deepseek', model: 'deepseek-v4-flash-vision-exp' },
    modelSupportsImages: true,
    onAddFiles: vi.fn(),
    onChange: vi.fn(),
    onModelMenuOpenChange: vi.fn(),
    onModelOptionsChange: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenSummary: vi.fn(),
    onOpenTemplates: vi.fn(),
    onPreviewContext: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onRetryAttachment: vi.fn(),
    onStop: vi.fn(),
    onSubmit: vi.fn(),
    onToolsMenuOpenChange: vi.fn(),
    placeholder: '输入消息',
    runtime: null,
    toolsMenuOpen: false,
    value: '',
    ...overrides,
  }
  const view = render(<ChatComposer {...props} />)
  return { ...view, props }
}

beforeEach(() => {
  let objectUrl = 0
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => `blob:protected-${++objectUrl}`),
    revokeObjectURL: vi.fn(),
  })
  downloadConversationAttachment.mockReset().mockResolvedValue(
    new Blob(['image'], { type: 'image/png' }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('image attachment components', () => {
  it('accepts selection, paste and drop while exposing upload retry/remove states', () => {
    const { container, props } = renderComposer({
      attachments: [composerItem('error')],
      modelSupportsImages: false,
    })
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    const textarea = screen.getByPlaceholderText('输入消息')
    const selected = new File(['selected'], 'selected.png', { type: 'image/png' })
    const ignored = new File(['text'], 'ignored.txt', { type: 'text/plain' })
    expect(input).not.toBeNull()

    fireEvent.change(input!, { target: { files: [selected] } })
    fireEvent.paste(textarea, { clipboardData: { files: [selected, ignored] } })
    fireEvent.drop(textarea, { dataTransfer: { files: [selected, ignored] } })

    expect(props.onAddFiles).toHaveBeenNthCalledWith(1, [selected])
    expect(props.onAddFiles).toHaveBeenNthCalledWith(2, [selected])
    expect(props.onAddFiles).toHaveBeenNthCalledWith(3, [selected])
    expect(screen.getByText('当前没有已配置且可用的图片模型。')).toBeVisible()
    fireEvent.click(screen.getByLabelText('重试上传 preview.png'))
    fireEvent.click(screen.getByLabelText('移除图片 preview.png'))
    expect(props.onRetryAttachment).toHaveBeenCalledWith('upload-1')
    expect(props.onRemoveAttachment).toHaveBeenCalledWith('upload-1')
  })

  it('loads protected historical images and opens a full preview without public URLs', async () => {
    render(<MessageAttachments attachments={[attachment()]} conversationId="conversation-1" />)
    await waitFor(() => expect(screen.getByAltText('preview.png')).toHaveAttribute('src', 'blob:protected-1'))
    expect(downloadConversationAttachment).toHaveBeenCalledWith(
      'conversation-1',
      attachment().id,
    )

    fireEvent.click(screen.getByLabelText('预览图片 preview.png'))
    await waitFor(() => expect(screen.getAllByAltText('preview.png')).toHaveLength(2))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(downloadConversationAttachment).toHaveBeenCalledTimes(2)
  })
})
