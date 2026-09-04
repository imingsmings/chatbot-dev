import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'bun:test'

const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relativePath), 'utf8')) as Record<string, unknown>
}

test('root manifest makes Bun the authoritative local package manager', async () => {
  const manifest = await readJson('package.json')
  const workspaces = manifest.workspaces as {
    packages?: string[]
    catalog?: Record<string, string>
  }

  assert.equal(manifest.packageManager, 'bun@1.4.0')
  assert.deepEqual(workspaces.packages, ['client', 'server', 'bun-server'])
  assert.deepEqual(workspaces.catalog, {
    '@types/node': '22.20.1',
    'bun-types': '1.4.0',
    typescript: '7.0.2',
  })
  assert.deepEqual(manifest.trustedDependencies, ['argon2'])
  assert.deepEqual(manifest.overrides, { 'fast-uri': '3.1.7' })
  const lockfile = await readFile(path.join(REPO_ROOT, 'bun.lock'), 'utf8')
  assert.match(lockfile, /"fast-uri": \["fast-uri@3\.1\.7"/)
})

test('local development and validation scripts no longer invoke pnpm', async () => {
  for (const relativePath of [
    'package.json',
    'client/package.json',
    'server/package.json',
    'bun-server/package.json',
  ]) {
    const manifest = await readJson(relativePath)
    const scripts = manifest.scripts as Record<string, string>
    for (const [name, command] of Object.entries(scripts)) {
      assert.doesNotMatch(command, /(^|\s)pnpm(?:\s|$)/, `${relativePath}#${name}`)
      assert.doesNotMatch(command, /(^|\s)bun --cwd(?:\s|$)/, `${relativePath}#${name}`)
    }
  }
})

test('Bun backend tests use bun:test and no Node compatibility test module', async () => {
  const testDirectory = path.join(REPO_ROOT, 'tests', 'bun-server')
  const files = (await readdir(testDirectory)).filter((file) => file.endsWith('.test.ts'))

  assert.equal(files.length, 45)
  for (const file of files) {
    const source = await readFile(path.join(testDirectory, file), 'utf8')
    assert.match(source, /from ['"]bun:test['"]/, file)
    assert.doesNotMatch(source, /from ['"]node:test['"]/, file)
  }
})
