import 'dotenv/config'

import createError from 'http-errors'
import express from 'express'
import cookieParser from 'cookie-parser'
import logger from 'morgan'
import indexRouter from './routes/index.ts'
import { registerClientHosting } from './config/clientHosting.ts'
import { getDeploymentConfig } from './config/deploymentConfig.ts'
import { validateStartupConfig } from './utils/runtimeConfig.ts'
import type { ErrorRequestHandler, RequestHandler } from 'express'

type CreateAppOptions = {
  validateRuntime?: boolean
  clientHosting?: {
    enabled: boolean
    distDir: string
  }
}

function createApp(options: CreateAppOptions = {}) {
  if (options.validateRuntime !== false) {
    validateStartupConfig()
  }

  const app = express()
  const clientHosting = options.clientHosting ?? getDeploymentConfig().client

  app.disable('x-powered-by')
  app.use(logger(app.get('env') === 'production' ? 'combined' : 'dev'))
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'same-origin')
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    }
    next()
  })
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: false }))
  app.use(cookieParser())

  // `/api` is the same-origin contract in development and production.
  app.use('/api', indexRouter)
  // Keep legacy root routes only while the separate Vite client is in use;
  // otherwise API paths such as `/conversations/:id` would shadow SPA routes.
  if (!clientHosting.enabled) {
    app.use('/', indexRouter)
  }
  registerClientHosting(app, clientHosting)

  const notFoundHandler: RequestHandler = (req, res, next) => {
    next(createError(404))
  }

  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    const status = typeof err.status === 'number' ? err.status : 500
    res.locals.message = err.message
    res.locals.error = req.app.get('env') === 'development' ? err : {}

    if (res.headersSent) {
      next(err)
      return
    }

    if (status >= 500) {
      console.error('Unhandled request error:', err)
    }

    res.status(status)
    res.json({
      message: status >= 500 && req.app.get('env') !== 'development'
        ? '服务异常'
        : err.message || '服务异常'
    })
  }

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export { createApp }
export default createApp
