import { randomUUID } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { listConversations } from '../utils/conversationStore.ts'
import { DATA_DIR } from '../utils/conversationStore/paths.ts'
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
  const nonce = randomUUID()
  const probePath = path.join(DATA_DIR, `.health-${process.pid}-${nonce}`)

  try {
    await listConversations()
    await writeFile(probePath, nonce, { encoding: 'utf8', flag: 'wx' })
    const storedNonce = await readFile(probePath, 'utf8')
    return storedNonce === nonce ? 'ok' : 'error'
  } catch {
    return 'error'
  } finally {
    await unlink(probePath).catch(() => undefined)
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
