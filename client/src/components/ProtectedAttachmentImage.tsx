import { useEffect, useState } from 'react'

import { downloadConversationAttachment } from '#api/conversations'
import { cn } from '#lib/utils'
import type { ImageAttachment } from '#types/chat'

type ProtectedAttachmentImageProps = {
  attachment: ImageAttachment
  className?: string
  conversationId: string
}

export function ProtectedAttachmentImage({
  attachment,
  className,
  conversationId,
}: ProtectedAttachmentImageProps) {
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    let objectUrl: string | null = null
    setSource(null)
    setFailed(false)
    void downloadConversationAttachment(conversationId, attachment.id)
      .then((blob) => {
        if (disposed) return
        objectUrl = URL.createObjectURL(blob)
        setSource(objectUrl)
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })

    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.id, conversationId])

  if (failed) {
    return (
      <span className={cn('grid place-items-center bg-[var(--surface-muted)] text-xs text-[var(--danger)]', className)}>
        图片不可用
      </span>
    )
  }

  return source ? (
    <img
      alt={attachment.filename}
      className={className}
      height={attachment.height}
      src={source}
      width={attachment.width}
    />
  ) : (
    <span
      aria-label={`正在加载 ${attachment.filename}`}
      className={cn('animate-pulse bg-[var(--surface-muted)]', className)}
    />
  )
}
