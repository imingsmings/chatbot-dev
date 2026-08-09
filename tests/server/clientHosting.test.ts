import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createApp } from '../../server/app.ts'
import { assertClientBuild } from '../../server/config/clientHosting.ts'

async function createFixtureBuild(): Promise<string> {
  const distDir = await mkdtemp(join(tmpdir(), 'chatbot-client-build-'))
  await mkdir(join(distDir, 'assets'))
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>React production fixture</title>')
  await writeFile(join(distDir, 'assets', 'app-123.js'), 'globalThis.fixtureLoaded = true')
  await writeFile(join(distDir, 'robots.txt'), 'User-agent: *')
  return distDir
}

async function startTestServer(distDir: string): Promise<{
  origin: string
  close: () => Promise<void>
}> {
  const app = createApp({
    validateRuntime: false,
    clientHosting: { enabled: true, distDir }
  })
  const server = http.createServer(app)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  assert(address && typeof address !== 'string')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

test('client hosting fails startup when index build artifact is missing', () => {
  assert.throws(
    () => assertClientBuild({ enabled: true, distDir: join(tmpdir(), 'missing-chatbot-build') }),
    /前端构建不存在/
  )
})

test('built client hosting serves assets, SPA navigations, and API routes safely', async () => {
  const distDir = await createFixtureBuild()
  const server = await startTestServer(distDir)

  try {
    const home = await fetch(`${server.origin}/`)
    assert.equal(home.status, 200)
    assert.match(await home.text(), /React production fixture/)
    assert.equal(home.headers.get('cache-control'), 'no-cache')
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(home.headers.get('x-frame-options'), 'DENY')

    const deepLink = await fetch(`${server.origin}/conversations/demo`, {
      headers: { Accept: 'text/html' }
    })
    assert.equal(deepLink.status, 200)
    assert.match(await deepLink.text(), /React production fixture/)

    const asset = await fetch(`${server.origin}/assets/app-123.js`)
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')

    const regularStatic = await fetch(`${server.origin}/robots.txt`)
    assert.equal(regularStatic.status, 200)
    assert.equal(regularStatic.headers.get('cache-control'), 'public, max-age=3600')

    const runtime = await fetch(`${server.origin}/api/runtime-config`)
    assert.equal(runtime.status, 200)
    assert.equal(runtime.headers.get('content-type')?.includes('application/json'), true)

    const missingApi = await fetch(`${server.origin}/api/not-a-route`, {
      headers: { Accept: 'text/html' }
    })
    assert.equal(missingApi.status, 404)
    assert.deepEqual(await missingApi.json(), { message: 'Not Found' })

    const nonGetNavigation = await fetch(`${server.origin}/conversations/demo`, {
      method: 'POST',
      headers: { Accept: 'text/html' }
    })
    assert.equal(nonGetNavigation.status, 404)
  } finally {
    await server.close()
    await rm(distDir, { recursive: true, force: true })
  }
})
