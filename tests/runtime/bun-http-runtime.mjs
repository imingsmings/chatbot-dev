import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import https from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { findAvailablePort } from './backendHarness.mjs'

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

function requestHttps(url) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { rejectUnauthorized: false }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: response.headers,
        status: response.statusCode ?? 0,
      }))
    })
    request.once('error', reject)
    request.end()
  })
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', handleExit)
      reject(new Error('Timed out waiting for Bun HTTPS server shutdown'))
    }, timeoutMs)
    const handleExit = (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    }
    child.once('exit', handleExit)
  })
}

async function waitForHttps(url, child, getOutput, timeoutMs = 15_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Bun HTTPS server exited before readiness\n${getOutput()}`)
    }
    try {
      const response = await requestHttps(url)
      if (response.status === 200) return response
    } catch {
      // The listener may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${url}\n${getOutput()}`)
}

const tempRoot = await mkdtemp(path.join(tmpdir(), 'chatbot-bun-https-'))
const certificatePath = path.join(tempRoot, 'certificate.pem')
const privateKeyPath = path.join(tempRoot, 'private-key.pem')
const port = await findAvailablePort()
const output = []
let child

try {
  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-keyout',
    privateKeyPath,
    '-out',
    certificatePath,
  ])

  child = spawn('bun', ['./bin/www.ts'], {
    cwd: path.join(REPO_ROOT, 'bun-server'),
    env: {
      ...process.env,
      AUTH_ENABLED: 'false',
      CONVERSATION_DATA_DIR: path.join(tempRoot, 'data'),
      CONVERSATION_STORE: 'sqlite',
      DOTENV_CONFIG_PATH: '/dev/null',
      DOTENV_CONFIG_QUIET: 'true',
      HOST: '127.0.0.1',
      HTTPS_CERT_PATH: certificatePath,
      HTTPS_ENABLED: 'true',
      HTTPS_KEY_PATH: privateKeyPath,
      DEEPSEEK_API_KEY: 'bun-https-runtime-test-key',
      LLM_ENDPOINT: 'https://provider.invalid/chat/completions',
      LLM_PROVIDER: 'deepseek',
      NODE_ENV: 'test',
      PORT: String(port),
      SERVE_CLIENT_BUILD: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => output.push(Buffer.from(chunk)))
  child.stderr.on('data', (chunk) => output.push(Buffer.from(chunk)))
  const getOutput = () => Buffer.concat(output).toString('utf8')

  const live = await waitForHttps(
    `https://127.0.0.1:${port}/api/health/live`,
    child,
    getOutput,
  )
  assert.deepEqual(JSON.parse(live.body), { status: 'ok' })
  assert.equal(live.headers['strict-transport-security'], 'max-age=31536000')
  assert.equal(live.headers['x-content-type-options'], 'nosniff')

  const runtime = await requestHttps(`https://127.0.0.1:${port}/api/runtime-config`)
  assert.equal(runtime.status, 200)
  assert.equal(JSON.parse(runtime.body).runtime.storageBackend, 'sqlite')

  child.kill('SIGTERM')
  const exit = await waitForExit(child, 5_000)
  assert.deepEqual(exit, { code: 0, signal: null })
  assert.match(getOutput(), new RegExp(`https://127\\.0\\.0\\.1:${port}`))
  assert.match(getOutput(), /服务已停止/)

  console.log(JSON.stringify({
    gracefulShutdown: true,
    protocol: 'https',
    status: 'passed',
  }))
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await waitForExit(child, 2_000).catch(() => {})
  }
  await rm(tempRoot, { recursive: true, force: true })
}
