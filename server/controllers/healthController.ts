import { getHealthStatus } from '../services/healthService.ts'
import type { RequestHandler } from 'express'

const getHealth: RequestHandler = async (req, res) => {
  const health = await getHealthStatus()
  res.status(health.status === 'ok' ? 200 : 503).json(health)
}

export { getHealth }
