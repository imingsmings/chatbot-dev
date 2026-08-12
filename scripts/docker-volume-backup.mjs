import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  assertImageName,
  assertVolumeExists,
  assertVolumeName,
  assertVolumeStopped,
  discoverComposeDataVolume,
  hashFile,
  readVolumeManifest,
  runCommand
} from './docker-volume-utils.mjs'

function readArguments(argv) {
  const options = {
    image: 'chatbot:local',
    output: path.resolve('backups')
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!['--volume', '--output', '--image'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`)
    }
    options[argument.slice(2)] = value
    index += 1
  }

  options.output = path.resolve(options.output)
  return options
}

async function main() {
  const options = readArguments(process.argv.slice(2))
  assertImageName(options.image)
  const volumeName = options.volume || await discoverComposeDataVolume()
  assertVolumeName(volumeName, 'source volume')
  await assertVolumeExists(volumeName)
  await assertVolumeStopped(volumeName)

  const source = await readVolumeManifest(options.image, volumeName)
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const archiveName = `chatbot-data-${timestamp}.tar`
  const manifestName = `${archiveName}.manifest.json`
  const archivePath = path.join(options.output, archiveName)
  const manifestPath = path.join(options.output, manifestName)
  let archiveCreated = false

  await mkdir(options.output, { recursive: true })

  try {
    const archive = await open(archivePath, 'wx')
    archiveCreated = true
    try {
      await assertVolumeStopped(volumeName)
      await runCommand('docker', [
        'run',
        '--rm',
        '--entrypoint',
        'tar',
        '--mount',
        `type=volume,source=${volumeName},target=/data,readonly`,
        options.image,
        '-C',
        '/data',
        '-cpf',
        '-',
        '.'
      ], {
        stdio: ['ignore', archive.fd, 'inherit']
      })
    } finally {
      await archive.close()
    }

    await assertVolumeStopped(volumeName)
    const sourceAfterArchive = await readVolumeManifest(options.image, volumeName)
    if (sourceAfterArchive.treeSha256 !== source.treeSha256) {
      throw new Error('Source volume changed while the backup archive was being created')
    }

    const archiveSha256 = await hashFile(archivePath)
    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      sourceVolume: volumeName,
      image: options.image,
      archive: {
        file: archiveName,
        sha256: archiveSha256
      },
      data: source
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })

    console.log(`Backup archive: ${archivePath}`)
    console.log(`Backup manifest: ${manifestPath}`)
    console.log(`Data files: ${source.fileCount}; bytes: ${source.totalBytes}; tree sha256: ${source.treeSha256}`)
  } catch (error) {
    if (archiveCreated) {
      await rm(archivePath, { force: true }).catch(() => undefined)
    }
    await rm(manifestPath, { force: true }).catch(() => undefined)
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
