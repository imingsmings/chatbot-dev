import 'dotenv/config'
import { getAuthConfig } from '../config/authConfig.ts'
import { closeAuthSessionStores, revokeAllAuthSessions } from '../utils/authSessionStore.ts'

const config = getAuthConfig()
if (!config.enabled) throw new Error('AUTH_ENABLED 未启用')

try {
  const count = revokeAllAuthSessions(config, 'operator_revoke_all')
  console.log(`Revoked ${count} active authentication session(s).`)
} finally {
  closeAuthSessionStores()
}
