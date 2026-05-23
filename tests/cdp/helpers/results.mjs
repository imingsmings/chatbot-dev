import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

function extractLastJsonObject(output) {
  let lastJson = null

  for (let start = 0; start < output.length; start += 1) {
    if (output[start] !== '{') continue

    let depth = 0
    let inString = false
    let escaped = false

    for (let end = start; end < output.length; end += 1) {
      const char = output[end]

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === '"') {
          inString = false
        }
        continue
      }

      if (char === '"') {
        inString = true
        continue
      }

      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
      }

      if (depth === 0) {
        try {
          lastJson = JSON.parse(output.slice(start, end + 1))
          start = end
        } catch {
          // keep scanning for the next complete object
        }
        break
      }
    }
  }

  return lastJson
}

async function writeSuiteResult(repoRoot, suiteName, result) {
  const resultsDir = path.join(repoRoot, '.tmp', 'cdp-results')
  await mkdir(resultsDir, { recursive: true })

  const filePath = path.join(resultsDir, `${suiteName}.json`)
  await writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  return filePath
}

export {
  extractLastJsonObject,
  writeSuiteResult,
}
