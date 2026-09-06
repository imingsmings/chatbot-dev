import { createAuthRoutes } from './auth.ts'
import { chatRoutes } from './chat.ts'
import { conversationRoutes } from './conversations.ts'
import { healthRoutes } from './health.ts'
import { legacyRoutes } from './legacy.ts'
import { requestRoutes } from './requests.ts'
import { runtimeRoutes } from './runtime.ts'

function createRouteTables() {
  return {
    protectedRoutes: [
      ...conversationRoutes,
      ...chatRoutes,
      ...requestRoutes,
      ...runtimeRoutes,
      ...legacyRoutes,
    ],
    publicRoutes: [
      ...healthRoutes,
      ...createAuthRoutes(),
    ],
  }
}

export { createRouteTables }
