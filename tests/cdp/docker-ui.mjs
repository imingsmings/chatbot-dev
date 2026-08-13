import { mkdir } from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'
import { screenshot, waitForEval } from './helpers/appActions.mjs'
import { launchChrome, getPageTarget } from './helpers/browser.mjs'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { delay, stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'https://127.0.0.1:7443/'
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9445)
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const OUT_DIR = path.resolve(process.cwd(), '.tmp/docker-screenshots')

function probeLocalHttps(url) {
  return new Promise((resolve) => {
    const request = https.get(url, { rejectUnauthorized: false }, (response) => {
      response.resume()
      resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 400)
    })
    request.once('error', () => resolve(false))
    request.setTimeout(1_000, () => {
      resolve(false)
      request.destroy()
    })
  })
}

async function waitForLocalHttps(url, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeLocalHttps(url)) return true
    await delay(200)
  }
  return false
}

async function main() {
  if (!await waitForLocalHttps(APP_URL, 15_000)) {
    throw new Error(`Docker-hosted app is not reachable at ${APP_URL}`)
  }

  if (CAPTURE_SCREENSHOTS) {
    await mkdir(OUT_DIR, { recursive: true })
  }
  const { chrome } = await launchChrome({
    url: APP_URL,
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-docker-ui-',
    windowSize: '1440,1000',
    extraArgs: ['--ignore-certificate-errors', '--allow-insecure-localhost'],
  })
  let client

  try {
    const target = await getPageTarget(DEBUG_PORT, APP_URL)
    if (!target?.webSocketDebuggerUrl) {
      throw new Error('Docker UI page target was not found')
    }
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await waitForEval(client, `location.href.startsWith(${JSON.stringify(APP_URL)})`)
    await waitForEval(client, `Boolean(document.querySelector('textarea'))`)

    const state = await evaluate(client, `(() => ({
      protocol: location.protocol,
      hasComposer: Boolean(document.querySelector('textarea')),
      hasSidebar: Boolean(document.querySelector('.sidebar')),
      hasModelControl: Boolean(document.querySelector('.model-menu-trigger[aria-label^="Model and Effort:"]')),
      hasServiceError: document.body.innerText.includes('服务异常'),
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))()`)
    if (
      state.protocol !== 'https:' ||
      !state.hasComposer ||
      !state.hasSidebar ||
      !state.hasModelControl ||
      state.scrollWidth > state.viewportWidth ||
      state.hasServiceError
    ) {
      throw new Error(`Docker UI state invalid: ${JSON.stringify(state)}`)
    }

    const screenshotPath = await screenshot(
      client,
      OUT_DIR,
      'docker-chatbot-desktop',
      CAPTURE_SCREENSHOTS,
    )
    console.log(JSON.stringify({
      ok: true,
      appUrl: APP_URL,
      screenshot: screenshotPath,
      assertions: {
        https: state.protocol === 'https:',
        composerVisible: state.hasComposer,
        sidebarVisible: state.hasSidebar,
        modelControlVisible: state.hasModelControl,
        noHorizontalOverflow: state.scrollWidth <= state.viewportWidth,
      },
    }, null, 2))
  } finally {
    client?.close()
    await stopProcess(chrome)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
