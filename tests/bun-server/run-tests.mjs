import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..')
const BUN_BINARY = process.env.BUN_BINARY || 'bun'
const TEST_TIMEOUT_MS = process.env.BUN_SERVER_TEST_TIMEOUT_MS || '30000'

function runTest(file) {
  return new Promise((resolve) => {
    const child = spawn(
      BUN_BINARY,
      ['test', '--timeout', TEST_TIMEOUT_MS, `./tests/bun-server/${file}`],
      {
        cwd: REPO_ROOT,
        env: process.env,
        stdio: 'inherit',
      },
    )
    child.once('error', (error) => resolve({ file, code: null, error }))
    child.once('exit', (code, signal) => resolve({ file, code, signal }))
  })
}

const files = (await readdir(TEST_DIR))
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
const failures = []

for (const file of files) {
  console.log(`\n==> Bun server test: ${file}`)
  const result = await runTest(file)
  if (result.code !== 0) failures.push(result)
}

if (failures.length > 0) {
  console.error(`\n${failures.length}/${files.length} Bun server test files failed:`)
  for (const failure of failures) {
    const detail = failure.error?.message || failure.signal || `exit ${failure.code}`
    console.error(`- ${failure.file}: ${detail}`)
  }
  process.exitCode = 1
} else {
  console.log(`\nAll ${files.length} Bun server test files passed.`)
}
