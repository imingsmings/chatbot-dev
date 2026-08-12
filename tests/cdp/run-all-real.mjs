import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const REAL_SUITES = new Set([
  'all-real',
  'real-ui',
  'real-context',
  'real-markdown',
  'real-model-options',
  'real-openai',
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

async function main() {
  const suite = process.env.CDP_REAL_SUITE || 'all-real'
  if (!REAL_SUITES.has(suite)) {
    throw new Error(`Unsupported isolated real suite: ${suite}`)
  }

  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'chatbot-cdp-all-real-'))
  const [backendPort, vitePort] = await Promise.all([allocatePort(), allocatePort()])
  const backendUrl = `http://127.0.0.1:${backendPort}/`
  const appUrl = `http://127.0.0.1:${vitePort}/`
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
    child = spawn('node', ['tests/cdp/run-cdp-regression.mjs', suite], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LLM_PROVIDER: process.env.LLM_PROVIDER || 'openai',
        HOST: '127.0.0.1',
        PORT: String(backendPort),
        HTTPS_ENABLED: 'false',
        SERVE_CLIENT_BUILD: 'false',
        CONVERSATION_STORE: 'file',
        CONVERSATION_DATA_DIR: dataDir,
        APP_URL: appUrl,
        VITE_PORT: String(vitePort),
        BACKEND_URL: backendUrl,
        VITE_API_TARGET: backendUrl.replace(/\/$/, '')
      },
      detached: process.platform !== 'win32',
      stdio: 'inherit'
    })

    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    if (forwardedSignal) {
      process.exitCode = forwardedSignal === 'SIGINT' ? 130 : 143
      return
    }
    if (exit.signal) {
      throw new Error(`Real regression stopped by ${exit.signal}`)
    }
    if (exit.code !== 0) {
      process.exitCode = exit.code ?? 1
    }
  } finally {
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    await rm(dataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
