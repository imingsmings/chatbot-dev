import { randomUUID } from 'node:crypto'

import { createAbortError } from '../abort.ts'
import type { LlmProviderId } from '../../types/llm.ts'

const MAX_PROVIDER_ERROR_BYTES = 4 * 1024
const MAX_PROVIDER_ERROR_DETAIL_CHARS = 320
const MAX_PROVIDER_IDENTIFIER_CHARS = 120

type ProviderErrorFields = {
  code?: string
  detail?: string
  type?: string
}

type ProviderHttpDiagnostic = ProviderErrorFields & {
  correlationId: string
  provider: LlmProviderId
  providerRequestId?: string
  status: number
}

class ProviderHttpError extends Error {
  readonly diagnostic: ProviderHttpDiagnostic

  constructor(message: string, diagnostic: ProviderHttpDiagnostic) {
    super(message)
    this.name = 'ProviderHttpError'
    this.diagnostic = diagnostic
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b(?:sk|ds|key)-[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(
      /((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|authorization|cookie|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/([?&](?:api_key|access_token|token|key)=)[^&\s]+/gi, '$1[REDACTED]')
}

function sanitizeDetail(value: string): string | undefined {
  const sanitized = redactSensitiveText(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROVIDER_ERROR_DETAIL_CHARS)
  return sanitized || undefined
}

function sanitizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._:/-]/g, '')
    .slice(0, MAX_PROVIDER_IDENTIFIER_CHARS)
  return sanitized || undefined
}

function extractProviderErrorFields(rawBody: string): ProviderErrorFields {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}

  const nestedError = isRecord(parsed.error) ? parsed.error : undefined
  const message = nestedError?.message ?? parsed.message
  const code = nestedError?.code ?? parsed.code
  const type = nestedError?.type ?? parsed.type

  return {
    detail: typeof message === 'string' ? sanitizeDetail(message) : undefined,
    code: sanitizeIdentifier(code),
    type: sanitizeIdentifier(type),
  }
}

function readProviderRequestId(headers: Headers): string | undefined {
  for (const name of ['x-request-id', 'request-id', 'x-trace-id', 'cf-ray']) {
    const value = sanitizeIdentifier(headers.get(name))
    if (value) return value
  }
  return undefined
}

async function readLimitedErrorBody(
  response: Response,
  signal: AbortSignal,
  abortUpstream: () => void,
): Promise<string> {
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const abortHandler = () => {
    abortUpstream()
    void reader.cancel().catch(() => undefined)
  }

  if (signal.aborted) {
    await reader.cancel().catch(() => undefined)
    throw createAbortError()
  }
  signal.addEventListener('abort', abortHandler, { once: true })

  try {
    while (totalBytes < MAX_PROVIDER_ERROR_BYTES) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw createAbortError()
      if (done) break

      const remaining = MAX_PROVIDER_ERROR_BYTES - totalBytes
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
      chunks.push(chunk)
      totalBytes += chunk.byteLength
      if (value.byteLength > remaining) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
    if (totalBytes >= MAX_PROVIDER_ERROR_BYTES) {
      await reader.cancel().catch(() => undefined)
    }
  } catch (error) {
    if (signal.aborted) throw createAbortError()
    return ''
  } finally {
    signal.removeEventListener('abort', abortHandler)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(bytes)
}

async function createProviderHttpError({
  response,
  provider,
  signal,
  abortUpstream,
  correlationId = randomUUID(),
}: {
  response: Response
  provider: LlmProviderId
  signal: AbortSignal
  abortUpstream: () => void
  correlationId?: string
}): Promise<ProviderHttpError> {
  const rawBody = await readLimitedErrorBody(response, signal, abortUpstream)
  const fields = extractProviderErrorFields(rawBody)
  const providerRequestId = readProviderRequestId(response.headers)
  const diagnostic: ProviderHttpDiagnostic = {
    correlationId,
    provider,
    status: response.status,
    ...(providerRequestId ? { providerRequestId } : {}),
    ...fields,
  }
  console.error('Provider HTTP request failed', diagnostic)

  const fallbackDetail = sanitizeDetail(response.statusText)
  const detail = fields.detail ?? fallbackDetail
  const message = [
    `模型服务请求失败（HTTP ${response.status}）`,
    detail,
    `参考 ID：${correlationId}`,
  ].filter(Boolean).join('：')
  return new ProviderHttpError(message, diagnostic)
}

export {
  MAX_PROVIDER_ERROR_BYTES,
  ProviderHttpError,
  createProviderHttpError,
  extractProviderErrorFields,
  sanitizeDetail,
}
export type { ProviderHttpDiagnostic }
