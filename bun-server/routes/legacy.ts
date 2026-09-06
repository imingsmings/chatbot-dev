import { clearHistory, listHistory } from '../controllers/legacyController.ts'
import { defineRoute } from '../http/router.ts'

const legacyRoutes = [
  defineRoute('GET', '/history', listHistory),
  defineRoute('POST', '/clear', clearHistory, 'json'),
]

export { legacyRoutes }
