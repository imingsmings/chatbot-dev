import { useState, type FormEvent } from 'react'
import { Button } from '#components/ui/button'
import { Input } from '#components/ui/input'

type LoginPageProps = {
  error: string | null
  loading: boolean
  onLogin: (username: string, password: string) => Promise<void>
  retryAfterSeconds: number | null
}

export function LoginPage({ error, loading, onLogin, retryAfterSeconds }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || !username.trim() || !password) return
    try {
      await onLogin(username, password)
    } catch {
      // The auth state owns the stable user-facing error.
    }
  }

  return (
    <main className="login-page grid min-h-dvh place-items-center bg-[var(--app-bg)] px-4 text-[var(--text-primary)]">
      <form
        aria-label="登录"
        className="login-form w-full max-w-[380px] rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-7 shadow-xl"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <h1 className="m-0 text-2xl font-semibold text-[var(--text-heading)]">登录 AI 助手</h1>
        <p className="mt-2 mb-6 text-sm leading-6 text-[var(--text-secondary)]">
          请输入本地服务配置的用户名和密码。
        </p>
        <label className="mb-4 block text-sm font-medium" htmlFor="auth-username">
          用户名
          <Input
            autoComplete="username"
            className="mt-2"
            disabled={loading}
            id="auth-username"
            maxLength={128}
            onChange={(event) => setUsername(event.target.value)}
            required
            value={username}
          />
        </label>
        <label className="mb-5 block text-sm font-medium" htmlFor="auth-password">
          密码
          <Input
            autoComplete="current-password"
            className="mt-2"
            disabled={loading}
            id="auth-password"
            maxLength={1024}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {error ? (
          <p aria-live="polite" className="mb-4 text-sm text-[var(--danger)]" role="alert">
            {error}
            {retryAfterSeconds ? `（约 ${retryAfterSeconds} 秒后可重试）` : ''}
          </p>
        ) : null}
        <Button
          aria-busy={loading || undefined}
          className="w-full"
          disabled={loading || !username.trim() || !password}
          type="submit"
        >
          {loading ? '登录中...' : '登录'}
        </Button>
      </form>
    </main>
  )
}
