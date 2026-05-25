import 'dotenv/config'

import createError from 'http-errors'
import express from 'express'
import cookieParser from 'cookie-parser'
import logger from 'morgan'
import indexRouter from './routes/index.ts'
import { validateStartupConfig } from './utils/runtimeConfig.ts'
import type { ErrorRequestHandler, RequestHandler } from 'express'

validateStartupConfig()

const app = express()

app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())

app.use('/', indexRouter)

const notFoundHandler: RequestHandler = (req, res, next) => {
  next(createError(404))
}

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  res.locals.message = err.message
  res.locals.error = req.app.get('env') === 'development' ? err : {}

  if (res.headersSent) {
    next(err)
    return
  }

  res.status(err.status || 500)
  res.json({
    message: err.message || '服务异常'
  })
}

app.use(notFoundHandler)
app.use(errorHandler)

export default app
