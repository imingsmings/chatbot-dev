import path from 'node:path'
import { createBackendSpawnOptions } from './helpers/backendRuntime.mjs'
import { extractLastJsonObject, writeSuiteResult } from './helpers/results.mjs'
import { spawnProcess, stopProcess, waitForHttp, waitForProcessExit } from './helpers/services.mjs'

const REPO_ROOT = process.cwd()
const BUN_BINARY = process.env.BUN_BINARY || 'bun'
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const CLIENT_DIR = process.env.CDP_CLIENT_DIR || 'client'
const VITE_PORT = process.env.VITE_PORT || new URL(APP_URL).port || '5173'
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:7001/'
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1' ? '1' : '0'
const ABORT_APP_URL = process.env.CDP_ABORT_APP_URL || 'http://localhost:5184/'

const UI_SCENARIOS = [
  {
    name: 'UI conversation operation scenarios',
    script: 'tests/cdp/scenarios/ui/conversation-operations.mjs',
    needsVite: true,
  },
  {
    name: 'UI stream recovery scenarios',
    script: 'tests/cdp/scenarios/ui/stream-recovery.mjs',
    needsVite: true,
  },
  {
    name: 'UI scroll and layout scenarios',
    script: 'tests/cdp/scenarios/ui/layout-scroll.mjs',
    needsVite: true,
  },
  {
    name: 'UI stream performance scenarios',
    script: 'tests/cdp/scenarios/ui/stream-performance.mjs',
    needsVite: true,
  },
  {
    name: 'UI model menu scenarios',
    script: 'tests/cdp/scenarios/ui/model-menu.mjs',
    needsVite: true,
  },
  {
    name: 'UI conversation model option persistence',
    script: 'tests/cdp/scenarios/ui/model-options-persistence.mjs',
    needsVite: true,
  },
  {
    name: 'UI custom prompt template management',
    script: 'tests/cdp/scenarios/ui/prompt-templates.mjs',
    needsVite: true,
  },
]

function readNonNegativeInteger(name, fallback) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

const SUITES = {
  p0: [
    {
      name: 'upstream abort',
      script: 'tests/cdp/upstream-abort.mjs',
      env: {
        APP_URL: ABORT_APP_URL,
        VITE_PORT: new URL(ABORT_APP_URL).port,
      },
    },
    { name: 'P0 API and tool scenarios', script: 'tests/cdp/p0-api-tool.mjs' },
    ...UI_SCENARIOS,
  ],
  p1: [
    ...UI_SCENARIOS,
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
    ...UI_SCENARIOS,
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
  'docker-ui': [
    { name: 'Docker-hosted UI validation', script: 'tests/cdp/docker-ui.mjs' },
  ],
  'model-options-persistence': [
    {
      name: 'UI conversation model option persistence',
      script: 'tests/cdp/scenarios/ui/model-options-persistence.mjs',
      needsVite: true,
    },
  ],
  'prompt-templates': [
    {
      name: 'UI custom prompt template management',
      script: 'tests/cdp/scenarios/ui/prompt-templates.mjs',
      needsVite: true,
    },
  ],
  'stream-performance': [
    {
      name: 'UI stream performance scenarios',
      script: 'tests/cdp/scenarios/ui/stream-performance.mjs',
      needsVite: true,
    },
  ],
  'request-recovery': [
    {
      name: 'UI persisted request recovery scenarios',
      script: 'tests/cdp/scenarios/ui/stream-recovery.mjs',
      needsVite: true,
      env: { APP_URL },
    },
  ],
  authentication: [
    {
      name: 'Authentication UI and refresh scenarios',
      script: 'tests/cdp/authentication.mjs',
      needsVite: true,
    },
  ],
  'image-attachments': [
    {
      name: 'Image attachment and Vision UI scenarios',
      script: 'tests/cdp/image-attachments.mjs',
      needsVite: true,
    },
  ],
  real: [
    { name: 'Real UI scenarios', script: 'tests/cdp/real-scenarios.mjs', needsVite: true, needsBackend: true },
    { name: 'Real conversation context scenarios', script: 'tests/cdp/conversation-context-real.mjs', needsVite: true, needsBackend: true },
    { name: 'Real Markdown scenarios', script: 'tests/cdp/markdown-real.mjs', needsVite: true, needsBackend: true },
  ],
  'real-ui': [
    { name: 'Real UI scenarios', script: 'tests/cdp/real-scenarios.mjs', needsVite: true, needsBackend: true },
  ],
  'real-context': [
    { name: 'Real conversation context scenarios', script: 'tests/cdp/conversation-context-real.mjs', needsVite: true, needsBackend: true },
  ],
  'real-markdown': [
    { name: 'Real Markdown scenarios', script: 'tests/cdp/markdown-real.mjs', needsVite: true, needsBackend: true },
  ],
  'real-model-options': [
    { name: 'Real model and reasoning options', script: 'tests/cdp/model-options-real.mjs', needsVite: true, needsBackend: true },
  ],
  'real-openai': [
    { name: 'Real OpenAI Responses scenarios', script: 'tests/cdp/openai-responses-real.mjs', needsVite: true, needsBackend: true },
  ],
  'real-vision': [
    { name: 'Real DeepSeek Vision scenarios', script: 'tests/cdp/vision-real.mjs', needsVite: true, needsBackend: true },
  ],
}

SUITES['all-mock'] = [
  ...SUITES.p0,
  ...SUITES.p1.filter(
    (item) =>
      !UI_SCENARIOS.some((uiScenario) => uiScenario.script === item.script) &&
      item.script !== 'tests/cdp/p0-api-tool.mjs',
  ),
  ...SUITES['context-debug'],
  ...SUITES['conversation-search'],
  ...SUITES['conversation-export'],
  ...SUITES.roadmap,
  ...SUITES['sidebar-state'],
  ...SUITES.authentication,
  ...SUITES['image-attachments'],
]

SUITES['all-real'] = [
  ...SUITES.real,
  ...SUITES['real-openai'],
]

async function ensureVite() {
  if (await waitForHttp(APP_URL, 1000)) {
    console.log(`Reusing existing Vite service at ${APP_URL}`)
    return null
  }

  const vite = spawnProcess(
    BUN_BINARY,
    ['--bun', 'vite', '--host', '127.0.0.1', '--port', VITE_PORT, '--strictPort'],
    {
      cwd: path.join(REPO_ROOT, CLIENT_DIR),
      env: process.env,
      killGroup: true,
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
  const healthUrl = new URL('/api/health', BACKEND_URL).toString()

  if (await waitForHttp(healthUrl, 1000)) {
    console.log(`Reusing existing backend service at ${BACKEND_URL}`)
    return null
  }

  const backendLaunch = createBackendSpawnOptions(REPO_ROOT)
  const backend = spawnProcess(backendLaunch.command, backendLaunch.args, {
    cwd: backendLaunch.cwd,
    env: backendLaunch.env,
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
  const timeoutMs = item.needsBackend
    ? readPositiveInteger('CDP_REAL_SCRIPT_TIMEOUT_MS', 600_000)
    : readPositiveInteger('CDP_SCRIPT_TIMEOUT_MS', 300_000)

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    console.log(`\n==> ${item.name}${maxRetries ? ` (attempt ${attempt}/${maxRetries + 1})` : ''}`)

    const processHandle = spawnProcess(BUN_BINARY, [item.script], {
      cwd: REPO_ROOT,
      killGroup: true,
      env: {
        ...process.env,
        CDP_SCREENSHOTS: CAPTURE_SCREENSHOTS,
        ...(item.env || {}),
      },
    })

    const exited = await waitForProcessExit(processHandle.child, timeoutMs)
    if (!exited) {
      await stopProcess(processHandle)
    }
    const code = exited ? processHandle.child.exitCode : null
    const output = processHandle.getOutput()
    const result = extractLastJsonObject(output)
    attempts.push({
      attempt,
      exitCode: code,
      timedOut: !exited,
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
      console.warn(`${item.name} ${exited ? `failed with exit code ${code}` : `timed out after ${timeoutMs}ms`}; retrying`)
    }
  }

  const lastAttempt = attempts[attempts.length - 1]
  throw new Error(lastAttempt?.timedOut
    ? `${item.name} timed out after ${timeoutMs}ms`
    : `${item.name} failed with exit code ${lastAttempt?.exitCode}`)
}

async function main() {
  const suiteName = process.argv[2]
  const suite = SUITES[suiteName]

  if (!suite) {
    console.error(`Usage: bun tests/cdp/run-cdp-regression.mjs <${Object.keys(SUITES).join('|')}>`)
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
