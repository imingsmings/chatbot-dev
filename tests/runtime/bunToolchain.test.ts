import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
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
  assert.deepEqual(workspaces.packages, ['client', 'bun-server'])
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

  assert.equal(files.length, 46)
  for (const file of files) {
    const source = await readFile(path.join(testDirectory, file), 'utf8')
    assert.match(source, /from ['"]bun:test['"]/, file)
    assert.doesNotMatch(source, /from ['"]node:test['"]/, file)
  }
})

test('repository exposes one Bun backend and no Node comparison entrypoints', async () => {
  const manifest = await readJson('package.json')
  const scripts = manifest.scripts as Record<string, string>
  const commands = Object.values(scripts).join('\n')

  await assert.rejects(access(path.join(REPO_ROOT, 'server', 'package.json')))
  await assert.rejects(access(path.join(REPO_ROOT, 'tests', 'server')))
  assert.deepEqual(manifest.engines, { bun: '>=1.4.0' })
  assert.equal(scripts['dev:server'], 'bun run --cwd bun-server dev')
  assert.equal(scripts['start:server'], 'bun run --cwd bun-server start')
  assert.equal(scripts['typecheck:server'], 'bun run --cwd bun-server typecheck')
  assert.match(scripts['start:production'], /--cwd bun-server start$/)
  assert.doesNotMatch(commands, /(?:--cwd server|node --test|tests\/server|backend-parity|sqlite-runtime-compatibility|backend-benchmark)/)
  assert.equal(scripts['test:bun-server'], undefined)
  assert.equal(scripts['test:cdp:all-mock:bun'], undefined)
})

test('Bun backend uses bun:sqlite without node:sqlite compatibility imports', async () => {
  const sourceDirectories = [
    path.join(REPO_ROOT, 'bun-server'),
    path.join(REPO_ROOT, 'tests', 'bun-server'),
  ]
  const sourceFiles: string[] = []

  for (const directory of sourceDirectories) {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true })
    for (const entry of entries) {
      if (
        !entry.parentPath.split(path.sep).includes('node_modules') &&
        entry.isFile() &&
        entry.name.endsWith('.ts')
      ) {
        sourceFiles.push(path.join(entry.parentPath, entry.name))
      }
    }
  }

  const sources = await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')))
  assert.equal(sources.some((source) => source.includes("from 'node:sqlite'")), false)
  assert.equal(sources.some((source) => source.includes('from "node:sqlite"')), false)
  assert.match(
    await readFile(path.join(REPO_ROOT, 'bun-server', 'utils', 'conversationStore', 'sqliteStore.ts'), 'utf8'),
    /from ['"]bun:sqlite['"]/,
  )
  assert.match(
    await readFile(path.join(REPO_ROOT, 'bun-server', 'utils', 'authSessionStore.ts'), 'utf8'),
    /from ['"]bun:sqlite['"]/,
  )
})

test('Bun backend owns HTTP through Bun.serve without Express compatibility dependencies', async () => {
  const manifest = await readJson('bun-server/package.json')
  const dependencies = {
    ...(manifest.dependencies as Record<string, string>),
    ...(manifest.devDependencies as Record<string, string>),
  }
  for (const dependency of [
    'busboy',
    'cookie-parser',
    'debug',
    'express',
    'express-rate-limit',
    'http-errors',
    'morgan',
    '@types/busboy',
    '@types/cookie-parser',
    '@types/debug',
    '@types/express',
    '@types/http-errors',
    '@types/morgan',
  ]) {
    assert.equal(dependencies[dependency], undefined, dependency)
  }

  const sourceDirectory = path.join(REPO_ROOT, 'bun-server')
  const sourceFiles = (await readdir(sourceDirectory, { recursive: true, withFileTypes: true }))
    .filter((entry) => (
      !entry.parentPath.split(path.sep).includes('node_modules') &&
      entry.isFile() &&
      entry.name.endsWith('.ts')
    ))
    .map((entry) => path.join(entry.parentPath, entry.name))
  const sources = await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')))
  const forbiddenRuntimeImports = /from ['"](?:express|express-rate-limit|cookie-parser|morgan|busboy|debug|http-errors|node:http|node:https)['"]/
  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, forbiddenRuntimeImports, sourceFiles[index])
  }

  assert.match(
    await readFile(path.join(REPO_ROOT, 'bun-server', 'bin', 'www.ts'), 'utf8'),
    /Bun\.serve\(/,
  )
})

test('Docker production delivery uses Bun without Node or pnpm build inputs', async () => {
  const manifest = await readJson('package.json')
  const scripts = manifest.scripts as Record<string, string>
  const dockerfile = await readFile(path.join(REPO_ROOT, 'Dockerfile'), 'utf8')
  const compose = await readFile(path.join(REPO_ROOT, 'compose.yaml'), 'utf8')
  const entrypoint = await readFile(path.join(REPO_ROOT, 'docker', 'entrypoint.sh'), 'utf8')
  const volumeUtils = await readFile(path.join(REPO_ROOT, 'scripts', 'docker-volume-utils.mjs'), 'utf8')

  await assert.rejects(access(path.join(REPO_ROOT, 'pnpm-lock.yaml')))
  await assert.rejects(access(path.join(REPO_ROOT, 'pnpm-workspace.yaml')))
  assert.match(dockerfile, /FROM oven\/bun:\$\{BUN_VERSION\}-slim/)
  assert.match(dockerfile, /bun install --frozen-lockfile --production --filter bun-server/)
  assert.match(dockerfile, /CMD \["bun", "bun-server\/bin\/www\.ts"\]/)
  assert.doesNotMatch(dockerfile, /(?:FROM node:|\bpnpm\b|COPY server(?:\s|\/))/)
  assert.match(compose, /\.\/bun-server\/\.env/)
  assert.match(compose, /\["CMD", "bun", "\/app\/docker\/healthcheck\.ts"\]/)
  assert.doesNotMatch(compose, /(?:\bnode\b|\.\/server\/\.env)/)
  assert.match(entrypoint, /--reuid=bun --regid=bun/)
  assert.doesNotMatch(entrypoint, /--reuid=node|--regid=node/)
  assert.match(volumeUtils, /'--entrypoint',\s*\n\s*'bun'/)
  assert.equal(scripts['docker:config'], 'docker compose config --quiet')
  assert.equal(scripts['docker:build'], 'docker compose build --pull')
  assert.equal(scripts['docker:up'], 'docker compose up -d')
  assert.equal(scripts['test:docker'], 'bun tests/docker/container-smoke.mjs')
  assert.equal(scripts['test:cdp:docker-ui'], 'bun tests/cdp/docker-ui.mjs')
})
