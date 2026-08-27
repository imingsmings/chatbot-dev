import type { RequestHandler, Response } from 'express'

import {
  AttachmentError,
  createImageAttachment,
  deleteConversationAttachment,
  getConversationAttachment,
} from '../services/attachmentService.ts'
import { parseImageUploadRequest } from '../utils/imageUpload.ts'

type AttachmentParams = {
  id: string
  attachmentId: string
}

function handleAttachmentError(error: unknown, res: Response): boolean {
  if (!(error instanceof AttachmentError)) return false
  if (error.status === 499) {
    if (!res.headersSent) res.status(499).end()
    return true
  }
  res.status(error.status).json({ message: error.message })
  return true
}

const uploadConversationAttachment: RequestHandler<Pick<AttachmentParams, 'id'>> = async (
  req,
  res,
  next,
) => {
  try {
    const upload = await parseImageUploadRequest(req)
    const attachment = await createImageAttachment(req.params.id, upload)
    res.status(201).json({ attachment })
  } catch (error) {
    if (!handleAttachmentError(error, res)) next(error)
  }
}

const readConversationAttachment: RequestHandler<AttachmentParams> = async (req, res, next) => {
  try {
    const { attachment, data } = await getConversationAttachment(
      req.params.id,
      req.params.attachmentId,
    )
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`)
    res.type(attachment.mediaType).send(data)
  } catch (error) {
    if (!handleAttachmentError(error, res)) next(error)
  }
}

const deleteConversationAttachmentHandler: RequestHandler<AttachmentParams> = async (
  req,
  res,
  next,
) => {
  try {
    await deleteConversationAttachment(req.params.id, req.params.attachmentId)
    res.status(204).end()
  } catch (error) {
    if (!handleAttachmentError(error, res)) next(error)
  }
}

export {
  deleteConversationAttachmentHandler,
  readConversationAttachment,
  uploadConversationAttachment,
}
