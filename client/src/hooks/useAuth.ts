import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { authClient } from '#auth/authClient'

export function useAuth() {
  const snapshot = useSyncExternalStore(
    authClient.subscribe,
    authClient.getSnapshot,
    authClient.getSnapshot,
  )

  const initialize = useCallback(() => authClient.initialize(), [])
  const login = useCallback((username: string, password: string) => (
    authClient.login(username, password)
  ), [])
  const logout = useCallback(() => authClient.logout(), [])

  return { ...snapshot, initialize, login, logout }
}

export function useInitializeAuth() {
  const { initialize } = useAuth()
  useEffect(() => {
    void initialize()
  }, [initialize])
}
