import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { hashPassword } from '../../server/security/password.ts'

const REAL_SUITES = new Set([
  'all-real',
  'real-ui',
  'real-context',
  'real-markdown',
  'real-model-options',
  'real-openai',
  'real-vision',
])

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a test port')))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function readPositiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

async function resolveRealModelWaitTimeoutMs() {
  const explicitWaitTimeout = readPositiveInteger(
    process.env.CDP_REAL_MODEL_WAIT_TIMEOUT_MS,
    null,
  )
  if (explicitWaitTimeout) return explicitWaitTimeout

  let configuredLlmTimeout = readPositiveInteger(process.env.LLM_TIMEOUT_MS, 30_000)
  try {
    const serverEnv = parseEnv(await readFile(path.join(process.cwd(), 'server/.env'), 'utf8'))
    configuredLlmTimeout = readPositiveInteger(serverEnv.LLM_TIMEOUT_MS, configuredLlmTimeout)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  return Math.max(240_000, configuredLlmTimeout + 15_000)
}

async function main() {
  const requestedSuite = process.env.CDP_REAL_SUITE || 'all-real'
  if (!REAL_SUITES.has(requestedSuite)) {
    throw new Error(`Unsupported isolated real suite: ${requestedSuite}`)
  }

  const runs = requestedSuite === 'all-real'
      ? [
        { suite: 'all-real', provider: 'deepseek', model: 'deepseek-v4-pro' },
        { suite: 'real-model-options', provider: 'deepseek' },
        { suite: 'real-vision', provider: 'deepseek', model: 'deepseek-v4-flash-vision-exp' },
      ]
    : [{
        suite: requestedSuite,
        provider: ['real-model-options', 'real-vision'].includes(requestedSuite) ? 'deepseek' : 'openai',
        ...(requestedSuite === 'real-vision' ? { model: 'deepseek-v4-flash-vision-exp' } : {}),
      }]
  const realModelWaitTimeoutMs = await resolveRealModelWaitTimeoutMs()
  let child
  let forwardedSignal
  const forwardSignal = (signal) => {
    forwardedSignal = signal
    if (!child?.pid) return
    if (process.platform === 'win32') {
      child.kill(signal)
      return
    }
    try {
      process.kill(-child.pid, signal)
    } catch {
      child.kill(signal)
    }
  }
  const handleSigint = () => forwardSignal('SIGINT')
  const handleSigterm = () => forwardSignal('SIGTERM')
  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)

  try {
    for (const run of runs) {
      const dataDir = await mkdtemp(path.join(os.tmpdir(), `chatbot-cdp-${run.suite}-`))
      const [backendPort, vitePort] = await Promise.all([allocatePort(), allocatePort()])
      const backendUrl = `http://127.0.0.1:${backendPort}/`
      const appUrl = `http://127.0.0.1:${vitePort}/`
      const authUsername = `real-test-${process.pid}`
      const authPassword = randomBytes(24).toString('base64url')
      const authPasswordHash = await hashPassword(authPassword)

      console.log(`Running isolated ${run.suite} suite with ${run.provider} as the default provider`)
      if (run.suite === 'real-model-options') {
        console.log(`Real model response wait timeout: ${realModelWaitTimeoutMs}ms`)
      }
      try {
        child = spawn('node', ['tests/cdp/run-cdp-regression.mjs', run.suite], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: 'test',
            LLM_PROVIDER: run.provider,
            ...(run.model ? {
              LLM_MODEL: run.model,
              ...(run.provider === 'deepseek'
                ? { DEEPSEEK_MODEL: run.model }
                : { OPENAI_MODEL: run.model }),
            } : {}),
            HOST: '127.0.0.1',
            PORT: String(backendPort),
            HTTPS_ENABLED: 'false',
            SERVE_CLIENT_BUILD: 'false',
            CONVERSATION_STORE: 'file',
            CONVERSATION_DATA_DIR: dataDir,
            AUTH_ENABLED: 'true',
            AUTH_USERNAME: authUsername,
            AUTH_PASSWORD_HASH: authPasswordHash,
            AUTH_ACCESS_TOKEN_SECRET: randomBytes(32).toString('base64url'),
            AUTH_REFRESH_TOKEN_SECRET: randomBytes(32).toString('base64url'),
            AUTH_ACCESS_TTL_SECONDS: '3600',
            AUTH_COOKIE_SECURE: 'false',
            AUTH_ALLOWED_ORIGINS: `${new URL(appUrl).origin},${new URL(backendUrl).origin}`,
            CDP_AUTH_USERNAME: authUsername,
            CDP_AUTH_PASSWORD: authPassword,
            APP_URL: appUrl,
            VITE_PORT: String(vitePort),
            BACKEND_URL: backendUrl,
            VITE_API_TARGET: backendUrl.replace(/\/$/, ''),
            ...(run.suite === 'real-model-options'
              ? { CDP_REAL_MODEL_WAIT_TIMEOUT_MS: String(realModelWaitTimeoutMs) }
              : {}),
          },
          detached: process.platform !== 'win32',
          stdio: 'inherit',
        })

        const exit = await new Promise((resolve, reject) => {
          child.once('error', reject)
          child.once('exit', (code, signal) => resolve({ code, signal }))
        })
        child = undefined
        if (forwardedSignal) {
          process.exitCode = forwardedSignal === 'SIGINT' ? 130 : 143
          return
        }
        if (exit.signal) {
          throw new Error(`Real regression stopped by ${exit.signal}`)
        }
        if (exit.code !== 0) {
          process.exitCode = exit.code ?? 1
          return
        }
      } finally {
        await rm(dataDir, { recursive: true, force: true })
      }
    }
  } finally {
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
