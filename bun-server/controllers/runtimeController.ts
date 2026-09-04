import { getRuntimeInfo } from '../services/runtimeInfoService.ts'
import type { RequestHandler } from 'express'

const getRuntimeConfiguration: RequestHandler = (req, res) => {
  res.json({
    runtime: getRuntimeInfo()
  })
}

export {
  getRuntimeConfiguration
}
