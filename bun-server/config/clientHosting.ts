import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

type ClientHostingConfig = {
  enabled: boolean
  distDir: string
}

function assertClientBuild(config: ClientHostingConfig): string {
  const indexPath = join(config.distDir, 'index.html')
  if (!existsSync(indexPath)) {
    throw new Error(`前端构建不存在：${indexPath}，请先运行 bun run build:client`)
  }
  return indexPath
}

function staticCacheControl(filePath: string): string {
  if (filePath.includes(`${sep}assets${sep}`)) {
    return 'public, max-age=31536000, immutable'
  }
  return 'public, max-age=3600'
}

function isHtmlNavigation(request: Request): boolean {
  if (request.method !== 'GET') return false
  const pathname = new URL(request.url).pathname
  if (pathname.startsWith('/api/') || pathname === '/api') return false
  const accept = request.headers.get('accept')?.toLowerCase()
  return !accept || accept.includes('text/html') || accept.includes('*/*')
}

function prepareClientHosting(config: ClientHostingConfig): string | null {
  if (!config.enabled) return null
  const indexPath = assertClientBuild(config)
  return indexPath
}

async function serveClientRequest(
  request: Request,
  config: ClientHostingConfig,
  indexPath: string,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname
  if (request.method === 'GET' || request.method === 'HEAD') {
    let decodedPath: string
    try {
      decodedPath = decodeURIComponent(pathname)
    } catch {
      return null
    }
    const candidate = resolve(config.distDir, decodedPath.replace(/^\/+/, ''))
    const relativePath = relative(config.distDir, candidate)
    const insideDist = relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`)
      && !relativePath.startsWith(sep)
    if (insideDist && relativePath) {
      const fileStat = await stat(candidate).catch(() => null)
      if (fileStat?.isFile()) {
        const file = Bun.file(candidate)
        return new Response(request.method === 'HEAD' ? null : file, {
          headers: {
            'Cache-Control': staticCacheControl(candidate),
            'Content-Type': file.type || 'application/octet-stream',
          },
        })
      }
    }
  }

  if (!isHtmlNavigation(request)) return null
  const index = Bun.file(indexPath)
  return new Response(index, {
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': index.type || 'text/html; charset=utf-8',
    },
  })
}

export {
  assertClientBuild,
  isHtmlNavigation,
  prepareClientHosting,
  serveClientRequest,
  staticCacheControl,
}
export type { ClientHostingConfig }
