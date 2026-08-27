import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  deleteConversationAttachment,
  uploadConversationAttachment,
} = vi.hoisted(() => ({
  deleteConversationAttachment: vi.fn(),
  uploadConversationAttachment: vi.fn(),
}))

vi.mock('../../../client/src/api/conversations', () => ({
  uploadConversationAttachment,
  deleteConversationAttachment,
}))

import { useImageAttachments } from '../../../client/src/hooks/useImageAttachments'
import type { ImageAttachment } from '../../../client/src/types/chat'

const revokeObjectURL = vi.fn()

function file(name: string) {
  return new File(['image'], name, { type: 'image/png' })
}

function attachment(index: number): ImageAttachment {
  return {
    id: `att_00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    kind: 'image',
    filename: `${index}.png`,
    mediaType: 'image/png',
    byteSize: 5,
    width: 1,
    height: 1,
    detail: 'auto',
  }
}

beforeEach(() => {
  let objectUrl = 0
  revokeObjectURL.mockReset()
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => `blob:test-${++objectUrl}`),
    revokeObjectURL,
  })
  uploadConversationAttachment.mockReset()
  deleteConversationAttachment.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useImageAttachments', () => {
  it('uploads at most four images, reports truncation and clears submitted previews without deleting files', async () => {
    uploadConversationAttachment.mockImplementation(async (_id: string, source: File) =>
      attachment(Number(source.name[0])),
    )
    const showError = vi.fn()
    const { result } = renderHook(() => useImageAttachments({
      conversationId: 'conversation-1',
      showError,
    }))

    act(() => result.current.addFiles([1, 2, 3, 4, 5].map((index) => file(`${index}.png`))))
    await waitFor(() => expect(result.current.readyAttachments).toHaveLength(4))
    expect(result.current.attachments.every(({ status }) => status === 'ready')).toBe(true)
    expect(showError).toHaveBeenCalledWith('本次只添加前 4 张图片，单条消息最多 4 张')
    expect(uploadConversationAttachment).toHaveBeenCalledTimes(4)

    act(() => result.current.clearSubmitted())
    expect(result.current.attachments).toHaveLength(0)
    expect(deleteConversationAttachment).not.toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledTimes(4)
  })

  it('retries failed uploads and discards ready files on conversation switches', async () => {
    uploadConversationAttachment
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce(attachment(1))
    const { result, rerender } = renderHook(
      ({ conversationId }) => useImageAttachments({ conversationId }),
      { initialProps: { conversationId: 'conversation-1' } },
    )

    act(() => result.current.addFiles([file('1.png')]))
    await waitFor(() => expect(result.current.attachments[0]?.status).toBe('error'))
    act(() => result.current.retryItem(result.current.attachments[0].clientId))
    await waitFor(() => expect(result.current.attachments[0]?.status).toBe('ready'))

    rerender({ conversationId: 'conversation-2' })
    await waitFor(() => expect(result.current.attachments).toHaveLength(0))
    expect(deleteConversationAttachment).toHaveBeenCalledWith(
      'conversation-1',
      attachment(1).id,
    )
  })

  it('retries a failed delete as delete instead of uploading a duplicate attachment', async () => {
    uploadConversationAttachment.mockResolvedValueOnce(attachment(1))
    deleteConversationAttachment
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useImageAttachments({
      conversationId: 'conversation-1',
    }))

    act(() => result.current.addFiles([file('1.png')]))
    await waitFor(() => expect(result.current.attachments[0]?.status).toBe('ready'))
    const clientId = result.current.attachments[0].clientId
    await act(async () => result.current.removeItem(clientId))
    expect(result.current.attachments[0]?.status).toBe('error')

    act(() => result.current.retryItem(clientId))
    await waitFor(() => expect(result.current.attachments).toHaveLength(0))
    expect(uploadConversationAttachment).toHaveBeenCalledTimes(1)
    expect(deleteConversationAttachment).toHaveBeenCalledTimes(2)
  })
})
