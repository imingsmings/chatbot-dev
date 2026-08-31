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
const AUTH_USERNAME = process.env.DOCKER_UI_USERNAME || ''
const AUTH_PASSWORD = process.env.DOCKER_UI_PASSWORD || ''
const EXPECTED_CONVERSATION_TITLE = process.env.DOCKER_UI_EXPECT_CONVERSATION_TITLE || ''
const EXPECTED_ATTACHMENT_FILENAME = process.env.DOCKER_UI_EXPECT_ATTACHMENT_FILENAME || ''

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
    await waitForEval(client, `Boolean(document.querySelector('textarea') || document.querySelector('#auth-username'))`)
    const loginRequired = await evaluate(client, `Boolean(document.querySelector('#auth-username'))`)
    if (loginRequired) {
      if (!AUTH_USERNAME || !AUTH_PASSWORD) {
        throw new Error('Docker UI requires authentication but test credentials were not provided')
      }
      await evaluate(client, `(() => {
        const setValue = (selector, value) => {
          const input = document.querySelector(selector);
          if (!(input instanceof HTMLInputElement)) throw new Error('Missing login input: ' + selector);
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setValue('#auth-username', ${JSON.stringify(AUTH_USERNAME)});
        setValue('#auth-password', ${JSON.stringify(AUTH_PASSWORD)});
        document.querySelector('form[aria-label="登录"]')?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
      })()`)
    }
    await waitForEval(client, `Boolean(document.querySelector('textarea'))`)

    if (EXPECTED_CONVERSATION_TITLE) {
      await waitForEval(
        client,
        `[...document.querySelectorAll('.conversation-item-shell')].some((shell) => {
          const button = shell.querySelector('.conversation-item');
          return shell.querySelector('.conversation-title')?.textContent === ${JSON.stringify(EXPECTED_CONVERSATION_TITLE)} &&
            button && !button.disabled;
        })`,
      )
      await evaluate(client, `(() => {
        const title = [...document.querySelectorAll('.conversation-title')]
          .find((node) => node.textContent === ${JSON.stringify(EXPECTED_CONVERSATION_TITLE)});
        const button = title?.closest('button');
        if (!(button instanceof HTMLButtonElement)) throw new Error('Expected conversation button not found');
        button.click();
      })()`)
      await waitForEval(
        client,
        `document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent === ${JSON.stringify(EXPECTED_CONVERSATION_TITLE)} &&
          document.querySelector('textarea')?.disabled === false`,
      )
    }

    if (EXPECTED_ATTACHMENT_FILENAME) {
      await waitForEval(
        client,
        `(() => {
          const image = [...document.querySelectorAll('img')]
            .find((node) => node.alt === ${JSON.stringify(EXPECTED_ATTACHMENT_FILENAME)});
          return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
        })()`,
      )
      await evaluate(client, `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((node) => node.getAttribute('aria-label') === ${JSON.stringify(`预览图片 ${EXPECTED_ATTACHMENT_FILENAME}`)});
        if (!(button instanceof HTMLButtonElement)) throw new Error('Expected attachment preview button not found');
        button.click();
      })()`)
      await waitForEval(
        client,
        `(() => {
          const images = [...document.querySelectorAll('[role="dialog"] img')]
            .filter((node) => node.alt === ${JSON.stringify(EXPECTED_ATTACHMENT_FILENAME)});
          return images.some((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
        })()`,
      )
    }

    const state = await evaluate(client, `(() => ({
      protocol: location.protocol,
      hasComposer: Boolean(document.querySelector('textarea')),
      hasSidebar: Boolean(document.querySelector('.sidebar')),
      hasModelControl: Boolean(document.querySelector('.model-menu-trigger[aria-label^="Model and Effort:"]')),
      hasServiceError: document.body.innerText.includes('服务异常'),
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      attachmentLoaded: ${EXPECTED_ATTACHMENT_FILENAME ? `[
        ...document.querySelectorAll('img'),
      ].some((image) => image.alt === ${JSON.stringify(EXPECTED_ATTACHMENT_FILENAME)} && image.complete && image.naturalWidth > 0)` : 'null'},
    }))()`)
    if (
      state.protocol !== 'https:' ||
      !state.hasComposer ||
      !state.hasSidebar ||
      !state.hasModelControl ||
      state.scrollWidth > state.viewportWidth ||
      state.hasServiceError ||
      (EXPECTED_ATTACHMENT_FILENAME && !state.attachmentLoaded)
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
        attachmentLoaded: state.attachmentLoaded,
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
