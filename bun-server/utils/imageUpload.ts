import Busboy from 'busboy'
import type { Request } from 'express'

import { MAX_IMAGE_ATTACHMENT_BYTES } from '../config/productLimits.ts'
import { AttachmentError, type ImageUpload } from '../services/attachmentService.ts'
import type { ImageAttachmentDetail } from '../types/conversation.ts'

function parseImageUploadRequest(req: Request): Promise<ImageUpload> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          fieldNameSize: 64,
          fieldSize: 32,
          fields: 2,
          fileSize: MAX_IMAGE_ATTACHMENT_BYTES,
          files: 2,
          parts: 3,
        },
      })
    } catch {
      reject(new AttachmentError('请求必须使用 multipart/form-data'))
      return
    }

    let filename = ''
    let mediaType = ''
    let detail: ImageAttachmentDetail = 'auto'
    let sawFile = false
    let fileCount = 0
    let fieldCount = 0
    let tooLarge = false
    let invalidField = false
    const chunks: Buffer[] = []

    parser.on('file', (fieldName, stream, info) => {
      fileCount += 1
      if (fileCount > 1 || fieldName !== 'image') {
        invalidField = true
        stream.resume()
        return
      }
      sawFile = true
      filename = info.filename
      mediaType = info.mimeType
      stream.on('limit', () => {
        tooLarge = true
      })
      stream.on('data', (chunk: Buffer) => {
        if (!tooLarge) chunks.push(Buffer.from(chunk))
      })
    })

    parser.on('field', (name, value) => {
      fieldCount += 1
      if (fieldCount > 1 || name !== 'detail' || !['auto', 'low', 'original'].includes(value)) {
        invalidField = true
        return
      }
      detail = value as ImageAttachmentDetail
    })

    parser.once('filesLimit', () => {
      invalidField = true
    })
    parser.once('fieldsLimit', () => {
      invalidField = true
    })
    parser.once('partsLimit', () => {
      invalidField = true
    })
    parser.once('error', reject)
    req.once('aborted', () => reject(new AttachmentError('图片上传已取消', 499)))
    parser.once('close', () => {
      if (tooLarge) {
        reject(new AttachmentError(`单张图片不能超过 ${MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024} MiB`, 413))
        return
      }
      if (invalidField) {
        reject(new AttachmentError('图片上传字段不合法'))
        return
      }
      if (!sawFile || chunks.length === 0) {
        reject(new AttachmentError('请选择要上传的图片'))
        return
      }
      resolve({
        buffer: Buffer.concat(chunks),
        filename,
        mediaType,
        detail,
      })
    })

    req.pipe(parser)
  })
}

export { parseImageUploadRequest }
