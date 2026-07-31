import path from 'node:path'
import { extractLastJsonObject, writeSuiteResult } from './helpers/results.mjs'
import { spawnProcess, stopProcess, waitForHttp } from './helpers/services.mjs'

const REPO_ROOT = process.cwd()
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:7001/'
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1' ? '1' : '0'

function readNonNegativeInteger(name, fallback) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

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
  'context-debug': [
    { name: 'Context debug scenarios', script: 'tests/cdp/context-debug.mjs', needsVite: true },
  ],
  'conversation-search': [
    { name: 'Conversation search scenarios', script: 'tests/cdp/conversation-search.mjs', needsVite: true },
  ],
  'conversation-export': [
    { name: 'Conversation export scenarios', script: 'tests/cdp/conversation-export.mjs', needsVite: true },
  ],
  roadmap: [
    { name: 'Roadmap feature scenarios', script: 'tests/cdp/roadmap-features.mjs', needsVite: true },
  ],
  'sidebar-state': [
    {
      name: 'Sidebar operation state scenarios',
      script: 'tests/cdp/sidebar-operation-state.mjs',
      needsVite: true,
    },
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
  ...SUITES['context-debug'],
  ...SUITES['conversation-search'],
  ...SUITES['conversation-export'],
  ...SUITES.roadmap,
  ...SUITES['sidebar-state'],
]

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
  const maxRetries = item.needsBackend
    ? readNonNegativeInteger('CDP_REAL_SCRIPT_RETRIES', readNonNegativeInteger('CDP_SCRIPT_RETRIES', 0))
    : readNonNegativeInteger('CDP_SCRIPT_RETRIES', 0)
  const attempts = []

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    console.log(`\n==> ${item.name}${maxRetries ? ` (attempt ${attempt}/${maxRetries + 1})` : ''}`)

    const processHandle = spawnProcess('node', [item.script], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CDP_SCREENSHOTS: CAPTURE_SCREENSHOTS,
        ...(item.env || {}),
      },
    })

    const code = await new Promise((resolve) => processHandle.child.once('exit', resolve))
    const output = processHandle.getOutput()
    const result = extractLastJsonObject(output)
    attempts.push({
      attempt,
      exitCode: code,
      result,
    })

    if (code === 0) {
      return {
        name: item.name,
        script: item.script,
        attempts,
        result,
      }
    }

    if (attempt <= maxRetries) {
      console.warn(`${item.name} failed with exit code ${code}; retrying`)
    }
  }

  throw new Error(`${item.name} failed with exit code ${attempts[attempts.length - 1]?.exitCode}`)
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
  const startedAt = new Date().toISOString()
  const results = []

  try {
    try {
      for (const item of suite) {
        results.push(await runScript(item))
      }

      const resultFile = await writeSuiteResult(REPO_ROOT, suiteName, {
        suite: suiteName,
        allPassed: true,
        startedAt,
        finishedAt: new Date().toISOString(),
        scripts: results,
      })
      console.log(`\nCDP regression suite passed: ${suiteName}`)
      console.log(`CDP regression result file: ${resultFile}`)
    } catch (err) {
      const resultFile = await writeSuiteResult(REPO_ROOT, suiteName, {
        suite: suiteName,
        allPassed: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        scripts: results,
        error: err instanceof Error ? err.message : String(err),
      })
      console.error(`CDP regression result file: ${resultFile}`)
      throw err
    }
  } finally {
    await stopProcess(vite)
    await stopProcess(backend)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
