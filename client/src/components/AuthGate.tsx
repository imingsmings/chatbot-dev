import { App } from '../app/App'
import { LoginPage } from '#components/LoginPage'
import { Button } from '#components/ui/button'
import { useAuth, useInitializeAuth } from '#hooks/useAuth'

export function AuthGate() {
  useInitializeAuth()
  const auth = useAuth()

  if (auth.status === 'authenticated' || auth.status === 'disabled') return <App />
  if (auth.status === 'unauthenticated') {
    return (
      <LoginPage
        error={auth.error}
        loading={auth.loggingIn}
        onLogin={auth.login}
        retryAfterSeconds={auth.retryAfterSeconds}
      />
    )
  }
  if (auth.status === 'error') {
    return (
      <main className="auth-error-state grid min-h-dvh place-items-center bg-[var(--app-bg)] px-4 text-[var(--text-primary)]">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">无法连接认证服务</h1>
          <p className="my-4 text-sm text-[var(--danger)]">{auth.error}</p>
          <Button onClick={() => void auth.initialize()} type="button">重试</Button>
        </div>
      </main>
    )
  }
  return (
    <main className="auth-loading-state grid min-h-dvh place-items-center bg-[var(--app-bg)] text-sm text-[var(--text-secondary)]">
      <output aria-live="polite">正在检查登录状态...</output>
    </main>
  )
}
