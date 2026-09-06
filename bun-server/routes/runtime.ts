import { getRuntimeConfiguration } from '../controllers/runtimeController.ts'
import { defineRoute } from '../http/router.ts'

const runtimeRoutes = [
  defineRoute('GET', '/runtime-config', getRuntimeConfiguration),
]

export { runtimeRoutes }
