import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
import {
  assertImageName,
  assertVolumeName,
  hashFile,
  readVolumeManifest,
  runCommand,
  volumeExists
} from './docker-volume-utils.mjs'

function readArguments(argv) {
  const options = { image: '' }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!['--manifest', '--volume', '--image'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`)
    }
    options[argument.slice(2)] = value
    index += 1
  }

  if (!options.manifest || !options.volume) {
    throw new Error('--manifest and --volume are required')
  }
  options.manifest = path.resolve(options.manifest)
  return options
}

function validateManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1
    || typeof manifest.image !== 'string'
    || typeof manifest.archive?.file !== 'string'
    || path.basename(manifest.archive.file) !== manifest.archive.file
    || !/^[a-f0-9]{64}$/.test(manifest.archive.sha256 || '')
    || !/^[a-f0-9]{64}$/.test(manifest.data?.treeSha256 || '')
  ) {
    throw new Error('Backup manifest is invalid or unsupported')
  }
}

async function restoreArchive(imageName, volumeName, archivePath) {
  const child = spawn('docker', [
    'run',
    '--rm',
    '-i',
    '--entrypoint',
    'tar',
    '--mount',
    `type=volume,source=${volumeName},target=/data`,
    imageName,
    '-C',
    '/data',
    '-xpf',
    '-'
  ], { stdio: ['pipe', 'inherit', 'inherit'] })

  const results = await Promise.allSettled([
    pipeline(createReadStream(archivePath), child.stdin),
    new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Restore container exited with code ${code}`))
      })
    })
  ])

  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }
}

async function main() {
  const options = readArguments(process.argv.slice(2))
  assertVolumeName(options.volume, 'target volume')
  if (await volumeExists(options.volume)) {
    throw new Error(`Refusing to overwrite existing Docker volume: ${options.volume}`)
  }

  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'))
  validateManifest(manifest)
  const imageName = options.image || manifest.image
  assertImageName(imageName)
  const archivePath = path.join(path.dirname(options.manifest), manifest.archive.file)
  const actualArchiveSha256 = await hashFile(archivePath)
  if (actualArchiveSha256 !== manifest.archive.sha256) {
    throw new Error('Backup archive sha256 does not match the manifest')
  }

  const restoreId = randomUUID()
  let volumeCreated = false
  try {
    await runCommand('docker', [
      'volume',
      'create',
      '--label',
      'com.chatbot.restore=true',
      '--label',
      `com.chatbot.restore-id=${restoreId}`,
      '--label',
      `com.chatbot.backup-sha256=${manifest.archive.sha256}`,
      options.volume
    ])
    const labelsResult = await runCommand('docker', [
      'volume',
      'inspect',
      '--format',
      '{{json .Labels}}',
      options.volume
    ])
    const labels = JSON.parse(labelsResult.stdout)
    if (labels?.['com.chatbot.restore-id'] !== restoreId) {
      throw new Error(`Refusing to use a Docker volume not created by this restore: ${options.volume}`)
    }
    volumeCreated = true

    await restoreArchive(imageName, options.volume, archivePath)
    const restored = await readVolumeManifest(imageName, options.volume)
    if (restored.treeSha256 !== manifest.data.treeSha256) {
      throw new Error('Restored data tree sha256 does not match the backup manifest')
    }

    console.log(`Restored volume: ${options.volume}`)
    console.log(`Data files: ${restored.fileCount}; bytes: ${restored.totalBytes}; tree sha256: ${restored.treeSha256}`)
  } catch (error) {
    if (volumeCreated) {
      const cleanup = await runCommand('docker', ['volume', 'rm', options.volume], {
        allowFailure: true
      })
      if (cleanup.code !== 0) {
        console.error(`Restore failed and the new volume could not be removed: ${options.volume}`)
      }
    }
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
