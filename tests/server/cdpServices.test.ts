import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import {
  stopProcess,
  waitForProcessExit,
} from '../cdp/helpers/services.mjs'

test('CDP process helpers time out and then fully stop a child process', async () => {
  const child = spawn(process.execPath, [
    '-e',
    "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),25));setInterval(()=>{},1000)",
  ], {
    stdio: 'ignore',
  })

  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })

    assert.equal(await waitForProcessExit(child, 10), false)
    await stopProcess(child)
    assert.equal(child.exitCode !== null || child.signalCode !== null, true)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await waitForProcessExit(child, 2_000)
    }
  }
})
