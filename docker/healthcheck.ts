const port = process.env.PORT?.trim() || '7001'

try {
  const response = await fetch(`https://127.0.0.1:${port}/api/health/live`, {
    tls: { rejectUnauthorized: false },
  })
  if (response.status !== 200) process.exit(1)
  const payload = await response.json() as { status?: unknown }
  process.exit(payload.status === 'ok' ? 0 : 1)
} catch {
  process.exit(1)
}
