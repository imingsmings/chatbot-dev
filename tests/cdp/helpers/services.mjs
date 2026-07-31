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
  const outputChunks = []
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
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
  }
}

async function stopProcess(processHandle) {
  const child = processHandle?.child || processHandle
  const cleanupPaths = Array.isArray(processHandle?.cleanupPaths)
    ? processHandle.cleanupPaths
    : []

  try {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(3000).then(() => child.kill('SIGKILL')),
      ])
    }
  } finally {
    await Promise.all(
      cleanupPaths.map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    )
  }
}

export {
  delay,
  spawnProcess,
  stopProcess,
  waitForHttp,
}
