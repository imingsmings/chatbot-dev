import 'dotenv/config'

import { getDeploymentConfig } from './config/deploymentConfig.ts'
import {
  prepareClientHosting,
  serveClientRequest,
  type ClientHostingConfig,
} from './config/clientHosting.ts'
import { HttpError, matchRoute, runRoute } from './http/router.ts'
import { BunHttpResponse, createHttpRequest } from './http/types.ts'
import { requireAuthentication } from './middleware/authentication.ts'
import { createRouteTables } from './routes/index.ts'
import { validateStartupConfig } from './utils/runtimeConfig.ts'
import type { HttpRequest } from './http/types.ts'

type CreateAppOptions = {
  validateRuntime?: boolean
  clientHosting?: ClientHostingConfig
}

type BunHttpHandler = BunRuntime.FetchHandler

function applySecurityHeaders(request: HttpRequest, response: BunHttpResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'same-origin')
  if (request.protocol === 'https') {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000')
  }
}

async function authorize(request: HttpRequest, response: BunHttpResponse): Promise<boolean> {
  let allowed = false
  let error: unknown
  await requireAuthentication(request, response, (nextError?: unknown) => {
    allowed = nextError === undefined
    error = nextError
  })
  if (error !== undefined) throw error
  return allowed
}

function createApp(options: CreateAppOptions = {}): BunHttpHandler {
  if (options.validateRuntime !== false) validateStartupConfig()

  const clientHosting = options.clientHosting ?? getDeploymentConfig().client
  const clientIndexPath = prepareClientHosting(clientHosting)
  const { protectedRoutes, publicRoutes } = createRouteTables()

  return async (rawRequest, server) => {
    const startedAt = performance.now()
    const request = createHttpRequest(rawRequest, server)
    const response = new BunHttpResponse(request)
    applySecurityHeaders(request, response)
    response.onFinish((statusCode) => {
      const elapsedMs = Math.max(0, performance.now() - startedAt).toFixed(1)
      console.info(`${request.method} ${request.path} ${statusCode} ${elapsedMs} ms`)
    })

    void (async () => {
      try {
        const pathname = request.path
        if (pathname === '/api' || pathname.startsWith('/api/')) {
          const apiPath = pathname.slice('/api'.length) || '/'
          const publicMatch = matchRoute(publicRoutes, request.method, apiPath)
          if (publicMatch) {
            await runRoute(publicMatch, request, response)
          } else if (await authorize(request, response)) {
            const protectedMatch = matchRoute(protectedRoutes, request.method, apiPath)
            if (protectedMatch) {
              await runRoute(protectedMatch, request, response)
            } else {
              response.status(404).json({ message: 'Not Found' })
            }
          }
        } else if (clientIndexPath) {
          const clientResponse = await serveClientRequest(rawRequest, clientHosting, clientIndexPath)
          if (clientResponse) {
            response.sendResponse(clientResponse)
          } else {
            response.status(404).json({ message: 'Not Found' })
          }
        } else if (await authorize(request, response)) {
          const legacyMatch = matchRoute(protectedRoutes, request.method, pathname)
          if (legacyMatch) {
            await runRoute(legacyMatch, request, response)
          } else {
            response.status(404).json({ message: 'Not Found' })
          }
        }

        if (!response.headersSent && !response.writableEnded) await response.end()
      } catch (error) {
        if (response.headersSent) {
          console.error('Unhandled streamed request error:', error)
          await response.end()
          return
        }

        const status = error instanceof HttpError
          ? error.status
          : typeof (error as { status?: unknown })?.status === 'number'
            ? (error as { status: number }).status
            : 500
        if (status >= 500) console.error('Unhandled request error:', error)
        response.status(status).json({
          message: status >= 500 && process.env.NODE_ENV !== 'development'
            ? '服务异常'
            : error instanceof Error ? error.message : '服务异常',
        })
      }
    })()

    return response.waitUntilReady()
  }
}

export { createApp }
export type { BunHttpHandler, CreateAppOptions }
export default createApp
