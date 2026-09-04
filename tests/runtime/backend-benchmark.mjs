import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import {
  findAvailablePort,
  startBackend,
  startMockProvider,
  stopBackend,
} from './backendHarness.mjs'

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const STARTUP_RUNS = 5
const REQUEST_RUNS = 200

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

async function readRssKb(pid) {
  const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)])
  return Number(stdout.trim())
}

async function measure(runtime, directory, providerUrl, root) {
  const startupMs = []
  let handle

  for (let index = 0; index < STARTUP_RUNS; index += 1) {
    handle = await startBackend({
      runtime,
      directory,
      repoRoot: REPO_ROOT,
      port: await findAvailablePort(),
      dataDir: path.join(root, `${runtime}-startup-${index}`),
      providerUrl,
    })
    startupMs.push(handle.readyMs)
    await stopBackend(handle)
  }

  handle = await startBackend({
    runtime,
    directory,
    repoRoot: REPO_ROOT,
    port: await findAvailablePort(),
    dataDir: path.join(root, `${runtime}-requests`),
    providerUrl,
  })
  try {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const rssKb = await readRssKb(handle.child.pid)
    const requestMs = []
    for (let index = 0; index < REQUEST_RUNS; index += 1) {
      const startedAt = performance.now()
      const response = await fetch(`${handle.origin}/api/health/live`)
      if (!response.ok) throw new Error(`${runtime} health request failed with ${response.status}`)
      await response.arrayBuffer()
      requestMs.push(performance.now() - startedAt)
    }

    const created = await fetch(`${handle.origin}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${runtime} benchmark` }),
    }).then((response) => response.json())
    const streamStartedAt = performance.now()
    const streamResponse = await fetch(`${handle.origin}/api/conversations/${created.conversation.id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Benchmark the first stream event',
        requestId: `${runtime}_benchmark_request`,
      }),
    })
    const reader = streamResponse.body.getReader()
    await reader.read()
    const firstStreamChunkMs = performance.now() - streamStartedAt
    await reader.cancel()

    return {
      startupMedianMs: percentile(startupMs, 0.5),
      idleRssKb: rssKb,
      healthP50Ms: percentile(requestMs, 0.5),
      healthP95Ms: percentile(requestMs, 0.95),
      firstStreamChunkMs,
    }
  } finally {
    await stopBackend(handle)
  }
}

const root = await mkdtemp(path.join(tmpdir(), 'chatbot-backend-benchmark-'))
const provider = await startMockProvider()

try {
  const node = await measure('node', 'server', provider.url, root)
  const bun = await measure('bun', 'bun-server', provider.url, root)
  const ratios = Object.fromEntries(
    Object.keys(node).map((key) => [key, Number((bun[key] / node[key]).toFixed(3))]),
  )
  const requiresReview = Object.entries(ratios)
    .filter(([, ratio]) => ratio > 1.2)
    .map(([metric, ratio]) => ({ metric, ratio }))

  console.log(JSON.stringify({ node, bun, ratios, requiresReview }, null, 2))
} finally {
  await provider.close()
  await rm(root, { recursive: true, force: true })
}
