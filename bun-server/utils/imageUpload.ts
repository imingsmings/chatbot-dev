import { MAX_IMAGE_ATTACHMENT_BYTES } from '../config/productLimits.ts'
import type { HttpRequest } from '../http/types.ts'
import { AttachmentError, type ImageUpload } from '../services/attachmentService.ts'
import type { ImageAttachmentDetail } from '../types/conversation.ts'

const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024

async function readBoundedMultipartBody(request: Request): Promise<Buffer> {
  const limit = MAX_IMAGE_ATTACHMENT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new AttachmentError(`单张图片不能超过 ${MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024} MiB`, 413)
  }
  if (!request.body) return Buffer.alloc(0)

  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new AttachmentError(`单张图片不能超过 ${MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024} MiB`, 413)
      }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    if (request.signal.aborted) throw new AttachmentError('图片上传已取消', 499)
    throw error
  }
  return Buffer.concat(chunks, total)
}

async function parseImageUploadRequest(req: HttpRequest): Promise<ImageUpload> {
  const contentType = req.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new AttachmentError('请求必须使用 multipart/form-data')
  }

  const body = await readBoundedMultipartBody(req.raw)
  let form: FormData
  try {
    form = await new Request(req.raw.url, {
      body: new Uint8Array(body),
      headers: req.raw.headers,
      method: 'POST',
    }).formData()
  } catch {
    throw new AttachmentError('请求必须使用 multipart/form-data')
  }

  const entries = [...form.entries()]
  const images = form.getAll('image')
  const details = form.getAll('detail')
  if (
    entries.some(([name]) => name !== 'image' && name !== 'detail') ||
    images.length !== 1 ||
    details.length > 1
  ) {
    throw new AttachmentError('图片上传字段不合法')
  }

  const image = images[0]
  if (!(image instanceof File) || image.size === 0) {
    throw new AttachmentError('请选择要上传的图片')
  }
  if (image.size > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new AttachmentError(`单张图片不能超过 ${MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024} MiB`, 413)
  }

  const detailValue = details[0] ?? 'auto'
  if (typeof detailValue !== 'string' || !['auto', 'low', 'original'].includes(detailValue)) {
    throw new AttachmentError('图片上传字段不合法')
  }

  return {
    buffer: Buffer.from(await image.arrayBuffer()),
    detail: detailValue as ImageAttachmentDetail,
    filename: image.name,
    mediaType: image.type,
  }
}

export { parseImageUploadRequest }
