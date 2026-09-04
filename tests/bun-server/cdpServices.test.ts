import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import {
  delay,
  spawnProcess,
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

test('CDP process helpers stop descendants in an isolated process group', {
  skip: process.platform === 'win32',
}, async () => {
  const processHandle = spawnProcess(process.execPath, [
    '-e',
    "const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000)",
  ], {
    killGroup: true,
  })

  let descendantPid = 0
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      descendantPid = Number(processHandle.getOutput().trim())
      if (Number.isInteger(descendantPid) && descendantPid > 0) break
      await delay(10)
    }
    assert.equal(descendantPid > 0, true)

    await stopProcess(processHandle)

    let descendantAlive = true
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        process.kill(descendantPid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          descendantAlive = false
          break
        }
        throw error
      }
      await delay(10)
    }
    assert.equal(descendantAlive, false)
  } finally {
    await stopProcess(processHandle)
    if (descendantPid > 0) {
      try {
        process.kill(descendantPid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
  }
})
