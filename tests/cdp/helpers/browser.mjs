import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnProcess, stopProcess, waitForHttp } from './services.mjs'

const DEFAULT_CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function launchChrome({
  url,
  debugPort,
  profilePrefix = 'chatbot-cdp-',
  windowSize = '1280,900',
  extraArgs = [],
}) {
  const profileDir = await mkdtemp(path.join(tmpdir(), profilePrefix))
  const chrome = spawnProcess(DEFAULT_CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars=false',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${windowSize}`,
    ...extraArgs,
    url,
  ])
  chrome.cleanupPaths = [profileDir]

  const ready = await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 15000)
  if (!ready) {
    await stopProcess(chrome)
    throw new Error(`Timed out waiting for Chrome CDP port ${debugPort}`)
  }

  return {
    chrome,
    profileDir,
  }
}

async function getPageTarget(debugPort, urlPrefix) {
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  return targets.find((item) => item.type === 'page' && item.url.startsWith(urlPrefix)) ||
    targets.find((item) => item.type === 'page')
}

export {
  getPageTarget,
  launchChrome,
}
