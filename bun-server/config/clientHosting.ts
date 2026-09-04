import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import express from 'express'
import type { Express, NextFunction, Request, Response } from 'express'

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

function setStaticCacheHeaders(res: Response, filePath: string): void {
  if (filePath.includes(`${sep}assets${sep}`)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    return
  }
  res.setHeader('Cache-Control', 'public, max-age=3600')
}

function isHtmlNavigation(req: Request): boolean {
  return req.method === 'GET'
    && !req.path.startsWith('/api/')
    && req.path !== '/api'
    && Boolean(req.accepts('html'))
}

function registerClientHosting(app: Express, config: ClientHostingConfig): void {
  if (!config.enabled) {
    return
  }

  const indexPath = assertClientBuild(config)

  app.use(express.static(config.distDir, {
    fallthrough: true,
    index: false,
    setHeaders: setStaticCacheHeaders
  }))

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isHtmlNavigation(req)) {
      next()
      return
    }

    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(indexPath)
  })
}

export {
  assertClientBuild,
  isHtmlNavigation,
  registerClientHosting,
  setStaticCacheHeaders
}
export type { ClientHostingConfig }
