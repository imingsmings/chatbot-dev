import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHttp(url, timeoutMs = 15000, options = {}) {
  const start = Date.now()
  const acceptStatus = options.acceptStatus || ((response) => response.ok)

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (acceptStatus(response)) return true
    } catch {
      // keep polling
    }

    await delay(200)
  }

  return false
}

function spawnProcess(command, args, options = {}) {
  const { killGroup = false, ...spawnOptions } = options
  const usesProcessGroup = killGroup && process.platform !== 'win32'
  const outputChunks = []
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...spawnOptions,
    detached: usesProcessGroup || spawnOptions.detached,
  })

  child.stdout.on('data', (chunk) => {
    outputChunks.push(Buffer.from(chunk))
    process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    outputChunks.push(Buffer.from(chunk))
    process.stderr.write(chunk)
  })

  return {
    child,
    getOutput: () => Buffer.concat(outputChunks).toString('utf8'),
    killGroup: usesProcessGroup,
  }
}

function signalProcess(processHandle, signal) {
  const child = processHandle?.child || processHandle
  if (!child) return false

  if (processHandle?.killGroup && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return true
    } catch {
      // Fall back to the direct child when its process group already exited.
    }
  }

  return child.kill(signal)
}

async function stopProcess(processHandle) {
  const child = processHandle?.child || processHandle
  const cleanupPaths = Array.isArray(processHandle?.cleanupPaths)
    ? processHandle.cleanupPaths
    : []

  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      signalProcess(processHandle, 'SIGTERM')
      const exitedAfterTerm = await waitForProcessExit(child, 3000)
      if (!exitedAfterTerm || processHandle?.killGroup) {
        signalProcess(processHandle, 'SIGKILL')
      }
      if (!exitedAfterTerm && child.exitCode === null && child.signalCode === null) {
        await waitForProcessExit(child, 2000)
      }
    }
  } finally {
    await Promise.all(
      cleanupPaths.map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    )
  }
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    const finish = (exited) => {
      clearTimeout(timer)
      child.off('exit', handleExit)
      resolve(exited)
    }
    const handleExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', handleExit)
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(true)
    }
  })
}

export {
  delay,
  spawnProcess,
  stopProcess,
  waitForProcessExit,
  waitForHttp,
}
