import { checkConversationStoreHealth } from '../utils/conversationStore.ts'
import { checkAuthSessionStoreHealth } from '../utils/authSessionStore.ts'
import { getAuthConfig } from '../config/authConfig.ts'
import { validateStartupConfig } from '../utils/runtimeConfig.ts'

type HealthCheckStatus = 'ok' | 'error'

type HealthStatus = {
  status: 'ok' | 'unhealthy'
  checks: {
    configuration: HealthCheckStatus
    storage: HealthCheckStatus
  }
}

async function checkConfiguration(): Promise<HealthCheckStatus> {
  try {
    validateStartupConfig()
    return 'ok'
  } catch {
    return 'error'
  }
}

async function checkStorage(): Promise<HealthCheckStatus> {
  try {
    await checkConversationStoreHealth()
    const authConfig = getAuthConfig()
    if (authConfig.enabled) checkAuthSessionStoreHealth(authConfig)
    return 'ok'
  } catch {
    return 'error'
  }
}

async function getHealthStatus(): Promise<HealthStatus> {
  const [configuration, storage] = await Promise.all([
    checkConfiguration(),
    checkStorage()
  ])
  const status = configuration === 'ok' && storage === 'ok' ? 'ok' : 'unhealthy'

  return {
    status,
    checks: {
      configuration,
      storage
    }
  }
}

export { getHealthStatus }
export type { HealthStatus }
