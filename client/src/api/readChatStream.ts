import {
  assertChatStreamProtocol,
  parseChatStreamEvent,
  type ChatStreamEvent,
} from '#utils/streamProtocol'

export type ReadChatStreamOptions = {
  onChunk?: () => void
  onEvent: (event: ChatStreamEvent) => void | Promise<void>
  response: Response
}

export async function readChatStream({
  onChunk,
  onEvent,
  response,
}: ReadChatStreamOptions): Promise<void> {
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(data?.message || `请求失败：${response.status}`)
  }

  assertChatStreamProtocol(response)

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('响应内容为空')
  }

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let streamDone = false

  const handleLine = async (line: string) => {
    const text = line.trim()
    if (!text) {
      return
    }

    const event = parseChatStreamEvent(text)
    await onEvent(event)
    if (event.type === 'done') {
      streamDone = true
    }
  }

  try {
    onChunk?.()

    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      onChunk?.()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        await handleLine(line)
        if (streamDone) {
          await reader.cancel()
          break
        }
      }
    }

    buffer += decoder.decode()

    if (!streamDone && buffer.trim()) {
      await handleLine(buffer)
    }
  } catch (error) {
    try {
      await reader.cancel()
    } catch {
      // Preserve the original protocol, stream, or abort error.
    }
    throw error
  }
}
