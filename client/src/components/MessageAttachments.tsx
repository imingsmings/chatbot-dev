import { useState } from 'react'

import { ProtectedAttachmentImage } from '#components/ProtectedAttachmentImage'
import {
  DialogClose,
  DialogContent,
  DialogRoot,
  DialogTitle,
} from '#components/ui/dialog'
import type { ImageAttachment } from '#types/chat'

type MessageAttachmentsProps = {
  attachments: ImageAttachment[]
  conversationId: string
}

export function MessageAttachments({ attachments, conversationId }: MessageAttachmentsProps) {
  const [selected, setSelected] = useState<ImageAttachment | null>(null)

  return (
    <>
      <div
        aria-label="消息图片"
        className="message-attachment-grid grid max-w-[520px] grid-cols-2 gap-2 max-[520px]:grid-cols-1"
      >
        {attachments.map((attachment) => (
          <button
            aria-label={`预览图片 ${attachment.filename}`}
            className="overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] text-left"
            key={attachment.id}
            onClick={() => setSelected(attachment)}
            type="button"
          >
            <ProtectedAttachmentImage
              attachment={attachment}
              className="block h-36 w-full object-cover"
              conversationId={conversationId}
            />
            <span className="block truncate px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
              {attachment.filename}
            </span>
          </button>
        ))}
      </div>

      <DialogRoot onOpenChange={(open) => { if (!open) setSelected(null) }} open={selected !== null}>
        <DialogContent className="max-h-[92dvh] max-w-[min(92vw,1100px)] overflow-auto">
          <DialogTitle>{selected?.filename ?? '图片预览'}</DialogTitle>
          {selected ? (
            <ProtectedAttachmentImage
              attachment={selected}
              className="mt-4 block max-h-[76dvh] w-full rounded-xl object-contain"
              conversationId={conversationId}
            />
          ) : null}
          <DialogClose />
        </DialogContent>
      </DialogRoot>
    </>
  )
}
