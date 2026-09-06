import { cancelActiveRequest, getRequestResult } from '../controllers/requestController.ts'
import { defineRoute } from '../http/router.ts'

const requestRoutes = [
  defineRoute('POST', '/requests/:requestId/cancel', cancelActiveRequest, 'json'),
  defineRoute('GET', '/requests/:requestId', getRequestResult),
]

export { requestRoutes }
