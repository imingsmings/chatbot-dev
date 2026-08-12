import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'

const rootDirectory = path.resolve(process.argv[2] || '/data')

async function hashFile(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function walk(directory, relativeDirectory = '') {
  const directoryEntries = await readdir(directory, { withFileTypes: true })
  directoryEntries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const entries = []

  for (const directoryEntry of directoryEntries) {
    const relativePath = path.posix.join(relativeDirectory, directoryEntry.name)
    const absolutePath = path.join(directory, directoryEntry.name)
    const stats = await lstat(absolutePath)

    if (stats.isSymbolicLink()) {
      throw new Error(`data volume contains unsupported symbolic link: ${relativePath}`)
    }

    if (stats.isDirectory()) {
      entries.push({ path: relativePath, type: 'directory' })
      entries.push(...await walk(absolutePath, relativePath))
      continue
    }

    if (!stats.isFile()) {
      throw new Error(`data volume contains unsupported entry: ${relativePath}`)
    }

    entries.push({
      path: relativePath,
      type: 'file',
      size: stats.size,
      sha256: await hashFile(absolutePath)
    })
  }

  return entries
}

const entries = await walk(rootDirectory)
const fileEntries = entries.filter((entry) => entry.type === 'file')
const treeSha256 = createHash('sha256')
  .update(JSON.stringify(entries))
  .digest('hex')

process.stdout.write(`${JSON.stringify({
  treeSha256,
  entryCount: entries.length,
  fileCount: fileEntries.length,
  totalBytes: fileEntries.reduce((total, entry) => total + entry.size, 0),
  entries
})}\n`)
