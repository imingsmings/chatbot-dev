import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { spawn } from 'node:child_process'

const VOLUME_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const IMAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@:-]*$/

function assertImageName(imageName) {
  if (!IMAGE_NAME_PATTERN.test(imageName || '')) {
    throw new Error(`image must match ${IMAGE_NAME_PATTERN}`)
  }
}

function assertVolumeName(volumeName, label = 'volume') {
  if (!VOLUME_NAME_PATTERN.test(volumeName || '')) {
    throw new Error(`${label} must match ${VOLUME_NAME_PATTERN}`)
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      const result = { code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }
      if (code === 0 || options.allowFailure) {
        resolve(result)
        return
      }

      reject(new Error(
        `${command} ${args.join(' ')} failed with exit code ${code}${stderr ? `: ${stderr}` : ''}`
      ))
    })
  })
}

async function hashFile(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function volumeExists(volumeName) {
  const result = await runCommand('docker', ['volume', 'inspect', volumeName], {
    allowFailure: true
  })
  return result.code === 0
}

async function assertVolumeExists(volumeName) {
  if (!await volumeExists(volumeName)) {
    throw new Error(`Docker volume does not exist: ${volumeName}`)
  }
}

async function assertVolumeStopped(volumeName) {
  const result = await runCommand('docker', [
    'ps',
    '-q',
    '--filter',
    `volume=${volumeName}`
  ])
  if (result.stdout) {
    throw new Error(`Docker volume is mounted by a running container: ${volumeName}`)
  }
}

async function discoverComposeDataVolume() {
  const composeResult = await runCommand('docker', ['compose', 'ps', '-aq', 'chatbot'])
  const containerIds = composeResult.stdout.split(/\s+/).filter(Boolean)
  if (containerIds.length !== 1) {
    throw new Error('Could not discover one stopped Compose chatbot container; pass --volume explicitly')
  }

  const inspectResult = await runCommand('docker', [
    'inspect',
    '--format',
    '{{json .Mounts}}',
    containerIds[0]
  ])
  const mounts = JSON.parse(inspectResult.stdout)
  const dataMount = mounts.find((mount) => (
    mount.Type === 'volume' && mount.Destination === '/app/data'
  ))
  if (!dataMount?.Name) {
    throw new Error('The Compose chatbot container has no named volume mounted at /app/data')
  }
  return dataMount.Name
}

async function readVolumeManifest(imageName, volumeName) {
  const result = await runCommand('docker', [
    'run',
    '--rm',
    '--entrypoint',
    'bun',
    '--mount',
    `type=volume,source=${volumeName},target=/data,readonly`,
    imageName,
    '/app/docker/volume-manifest.mjs',
    '/data'
  ])
  return JSON.parse(result.stdout)
}

export {
  assertImageName,
  assertVolumeExists,
  assertVolumeName,
  assertVolumeStopped,
  discoverComposeDataVolume,
  hashFile,
  readVolumeManifest,
  runCommand,
  volumeExists
}
