import { spawn } from 'node:child_process'
import path from 'node:path'

const REPO_ROOT = process.cwd()
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:7001/'
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1' ? '1' : '0'

const SUITES = {
  p0: [
    {
      name: 'upstream abort',
      script: 'tests/cdp/upstream-abort.mjs',
      env: {
        APP_URL: 'http://localhost:5174/',
        VITE_PORT: '5174',
      },
    },
    { name: 'P0 API and tool scenarios', script: 'tests/cdp/p0-api-tool.mjs' },
    { name: 'UI core scenarios', script: 'tests/cdp/ui-scenarios.mjs', needsVite: true },
  ],
  p1: [
    { name: 'UI interaction scenarios', script: 'tests/cdp/ui-scenarios.mjs', needsVite: true },
    { name: 'Markdown rendering scenarios', script: 'tests/cdp/markdown-rendering.mjs', needsVite: true },
    { name: 'Highlight rendering scenarios', script: 'tests/cdp/highlight-rendering.mjs', needsVite: true },
    { name: 'P1 storage/title boundary scenarios', script: 'tests/cdp/p0-api-tool.mjs' },
  ],
  markdown: [
    { name: 'Markdown rendering scenarios', script: 'tests/cdp/markdown-rendering.mjs', needsVite: true },
  ],
  highlight: [
    { name: 'Highlight rendering scenarios', script: 'tests/cdp/highlight-rendering.mjs', needsVite: true },
  ],
  ui: [
    { name: 'UI interaction scenarios', script: 'tests/cdp/ui-scenarios.mjs', needsVite: true },
  ],
  real: [
    { name: 'Real UI scenarios', script: 'tests/cdp/real-scenarios.mjs', needsVite: true, needsBackend: true },
    { name: 'Real conversation context scenarios', script: 'tests/cdp/conversation-context-real.mjs', needsVite: true, needsBackend: true },
    { name: 'Real Markdown scenarios', script: 'tests/cdp/markdown-real.mjs', needsVite: true, needsBackend: true },
  ],
}

SUITES['all-mock'] = [
  ...SUITES.p0,
  ...SUITES.p1.filter((item) => item.script !== 'tests/cdp/ui-scenarios.mjs' && item.script !== 'tests/cdp/p0-api-tool.mjs'),
]

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      // keep polling
    }

    await delay(200)
  }

  return false
}

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })

  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))

  return child
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return

  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3000).then(() => child.kill('SIGKILL')),
  ])
}

async function ensureVite() {
  if (await waitForHttp(APP_URL, 1000)) {
    console.log(`Reusing existing Vite service at ${APP_URL}`)
    return null
  }

  const vite = spawnProcess(
    'pnpm',
    ['exec', 'vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    {
      cwd: path.join(REPO_ROOT, 'client'),
      env: process.env,
    },
  )

  const ready = await waitForHttp(APP_URL, 15000)
  if (!ready) {
    await stopProcess(vite)
    throw new Error(`Timed out waiting for Vite at ${APP_URL}`)
  }

  return vite
}

async function ensureBackend() {
  const healthUrl = new URL('/conversations', BACKEND_URL).toString()

  if (await waitForHttp(healthUrl, 1000)) {
    console.log(`Reusing existing backend service at ${BACKEND_URL}`)
    return null
  }

  const backend = spawnProcess('node', ['./bin/www.ts'], {
    cwd: path.join(REPO_ROOT, 'server'),
    env: process.env,
  })

  const ready = await waitForHttp(healthUrl, 15000)
  if (!ready) {
    await stopProcess(backend)
    throw new Error(`Timed out waiting for backend at ${BACKEND_URL}`)
  }

  return backend
}

async function runScript(item) {
  console.log(`\n==> ${item.name}`)

  const child = spawnProcess('node', [item.script], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CDP_SCREENSHOTS: CAPTURE_SCREENSHOTS,
      ...(item.env || {}),
    },
  })

  const code = await new Promise((resolve) => child.once('exit', resolve))
  if (code !== 0) {
    throw new Error(`${item.name} failed with exit code ${code}`)
  }
}

async function main() {
  const suiteName = process.argv[2]
  const suite = SUITES[suiteName]

  if (!suite) {
    console.error(`Usage: node tests/cdp/run-cdp-regression.mjs <${Object.keys(SUITES).join('|')}>`)
    process.exitCode = 1
    return
  }

  const needsBackend = suite.some((item) => item.needsBackend)
  const needsVite = suite.some((item) => item.needsVite)
  const backend = needsBackend ? await ensureBackend() : null
  const vite = needsVite ? await ensureVite() : null

  try {
    for (const item of suite) {
      await runScript(item)
    }

    console.log(`\nCDP regression suite passed: ${suiteName}`)
  } finally {
    await stopProcess(vite)
    await stopProcess(backend)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
