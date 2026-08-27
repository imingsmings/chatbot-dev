import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cancelRequest,
  createConversationBranch,
  deleteConversationAttachment,
  downloadAllConversationsZip,
  downloadConversationAttachment,
  downloadConversationMarkdown,
  getConversations,
  importConversationsZip,
  requestConversationAnswer,
  uploadConversationAttachment,
} from '../../../client/src/api/conversations'

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('conversation API client', () => {
  it('reads the existing conversation list envelope', async () => {
    const conversation = {
      id: 'conversation-1',
      title: '测试会话',
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      messageCount: 0,
    }
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ conversations: [conversation] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(getConversations()).resolves.toEqual([conversation])
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations')
  })

  it('preserves server errors and invalid JSON errors', async () => {
    stubFetch(
      new Response(JSON.stringify({ message: '会话不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(getConversations()).rejects.toThrow('会话不存在')

    stubFetch(new Response('not-json', { status: 200 }))
    await expect(getConversations()).rejects.toThrow('服务端返回了无效 JSON')
  })

  it('keeps encoded download ids and UTF-8 filenames', async () => {
    const fetchMock = stubFetch(
      new Response('# conversation', {
        status: 200,
        headers: {
          'Content-Disposition': "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.md",
        },
      }),
    )

    await expect(downloadConversationMarkdown('folder/id')).resolves.toMatchObject({
      filename: '测试.md',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/folder%2Fid/export.md')
  })

  it('keeps the ask request body, abort signal and endpoint contract', async () => {
    const response = new Response(null, { status: 200 })
    const fetchMock = stubFetch(response)
    const controller = new AbortController()

    await expect(
      requestConversationAnswer({
        conversationId: 'folder/id',
        question: 'hello',
        requestId: 'request-1',
        signal: controller.signal,
        options: { temperature: 0.3, reasoningEnabled: true },
      }),
    ).resolves.toBe(response)

    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/folder%2Fid/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'hello',
        requestId: 'request-1',
        options: { temperature: 0.3, reasoningEnabled: true },
      }),
      signal: controller.signal,
    })
  })

  it('sends attachment ids only for image requests', async () => {
    const response = new Response(null, { status: 200 })
    const fetchMock = stubFetch(response)
    const controller = new AbortController()
    const attachmentIds = ['att_00000000-0000-4000-8000-000000000001']

    await requestConversationAnswer({
      conversationId: 'vision/id',
      question: '',
      requestId: 'request-vision',
      signal: controller.signal,
      options: { model: 'deepseek-v4-flash-vision-exp' },
      attachmentIds,
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/vision%2Fid/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: '',
        requestId: 'request-vision',
        options: { model: 'deepseek-v4-flash-vision-exp' },
        attachmentIds,
      }),
      signal: controller.signal,
    })
  })

  it('creates a branch with an encoded source id and target question', async () => {
    const conversation = {
      id: 'branch-1',
      title: '测试会话（分支）',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
      messages: [],
    }
    const fetchMock = stubFetch(
      Response.json({ conversation }, { status: 201 }),
    )

    await expect(
      createConversationBranch('folder/id', 2, '编辑后的问题'),
    ).resolves.toEqual({ conversation, draftAttachments: [] })
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/folder%2Fid/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageIndex: 2, question: '编辑后的问题' }),
    })
  })

  it('sends the cancellation reason so only manual stops are persisted', async () => {
    const fetchMock = stubFetch(Response.json({ cancelled: true, completed: true }))

    await expect(cancelRequest('request/1', 'transition')).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('/api/requests/request%2F1/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'transition' }),
    })
  })

  it('uses multipart for image upload and protected Blob endpoints for read/delete', async () => {
    const attachment = {
      id: 'att_00000000-0000-4000-8000-000000000001',
      kind: 'image' as const,
      filename: 'image.png',
      mediaType: 'image/png' as const,
      byteSize: 5,
      width: 1,
      height: 1,
      detail: 'low' as const,
    }
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    const uploadFetch = stubFetch(Response.json({ attachment }, { status: 201 }))
    await expect(uploadConversationAttachment('folder/id', file, { detail: 'low' }))
      .resolves.toEqual(attachment)
    const uploadOptions = uploadFetch.mock.calls[0]?.[1]
    expect(uploadFetch.mock.calls[0]?.[0]).toBe('/api/conversations/folder%2Fid/attachments')
    expect(uploadOptions?.method).toBe('POST')
    expect(uploadOptions?.headers).toBeUndefined()
    const uploadBody = uploadOptions?.body
    expect(uploadBody).toBeInstanceOf(FormData)
    if (!(uploadBody instanceof FormData)) throw new Error('upload body is not FormData')
    expect(uploadBody.get('detail')).toBe('low')
    expect(uploadBody.get('image')).toBeInstanceOf(File)

    const imageBlob = new Blob(['image'], { type: 'image/png' })
    const downloadFetch = stubFetch(new Response(imageBlob))
    await expect(downloadConversationAttachment('folder/id', attachment.id)).resolves.toEqual(imageBlob)
    expect(downloadFetch).toHaveBeenCalledWith(
      `/api/conversations/folder%2Fid/attachments/${attachment.id}`,
    )

    const deleteFetch = stubFetch(new Response(null, { status: 204 }))
    await deleteConversationAttachment('folder/id', attachment.id)
    expect(deleteFetch).toHaveBeenCalledWith(
      `/api/conversations/folder%2Fid/attachments/${attachment.id}`,
      { method: 'DELETE' },
    )
  })

  it('downloads and imports schema v2 ZIP backups', async () => {
    const archive = new Blob(['zip'], { type: 'application/zip' })
    const downloadFetch = stubFetch(new Response(archive, {
      headers: { 'Content-Disposition': 'attachment; filename="backup.zip"' },
    }))
    await expect(downloadAllConversationsZip()).resolves.toMatchObject({ filename: 'backup.zip' })
    expect(downloadFetch).toHaveBeenCalledWith('/api/conversations/export.zip')

    const file = new File(['zip'], 'backup.zip', { type: 'application/zip' })
    const result = { total: 1, created: 1, duplicated: 0, overwritten: 0, skipped: 0, items: [] }
    const importFetch = stubFetch(Response.json({ result }))
    await expect(importConversationsZip(file, 'overwrite')).resolves.toEqual(result)
    expect(importFetch).toHaveBeenCalledWith(
      '/api/conversations/import.zip?conflictStrategy=overwrite',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file,
      },
    )
  })
})
