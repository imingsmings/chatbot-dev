import { getHealth, getLiveness, getReadiness } from '../controllers/healthController.ts'
import { defineRoute } from '../http/router.ts'

const healthRoutes = [
  defineRoute('GET', '/health', getHealth),
  defineRoute('GET', '/health/live', getLiveness),
  defineRoute('GET', '/health/ready', getReadiness),
]

export { healthRoutes }
