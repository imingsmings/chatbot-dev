import { getRuntimeInfo } from '../services/runtimeInfoService.ts'
import type { RequestHandler } from '../http/types.ts'

const getRuntimeConfiguration: RequestHandler = (req, res) => {
  res.json({
    runtime: getRuntimeInfo()
  })
}

export {
  getRuntimeConfiguration
}
