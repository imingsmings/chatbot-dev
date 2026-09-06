import {
  getLivenessStatus,
  getReadinessStatus,
} from '../services/healthService.ts'
import type { RequestHandler } from '../http/types.ts'

const getLiveness: RequestHandler = (req, res) => {
  res.json(getLivenessStatus())
}

const getReadiness: RequestHandler = async (req, res) => {
  const health = await getReadinessStatus()
  res.status(health.status === 'ok' ? 200 : 503).json(health)
}

export {
  getReadiness as getHealth,
  getLiveness,
  getReadiness,
}
