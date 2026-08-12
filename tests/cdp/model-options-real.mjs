import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { ask, waitForEval } from './helpers/appActions.mjs'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const API_URL = new URL('/api', APP_URL).toString().replace(/\/$/, '')
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9338)
const REAL_WAIT_TIMEOUT_MS = readPositiveInteger('CDP_REAL_MODEL_WAIT_TIMEOUT_MS', 240000)
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const TITLE_PREFIX = `CDPMODELREAL-${STAMP}`

const MODELS = [
  { label: 'DeepSeek V4 Flash', value: 'deepseek-v4-flash' },
]
const EFFORTS = [
  { label: 'Off', value: 'off', enabled: false },
  { label: 'Low', value: 'low', enabled: true },
  { label: 'Medium', value: 'medium', enabled: true },
  { label: 'High', value: 'high', enabled: true },
]

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

async function clickSelector(client, selector) {
  const point = await evaluate(
    client,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Cannot find selector: ${selector}');
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
  )
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  })
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  })
}

async function createConversation(title) {
  const response = await fetch(`${API_URL}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!response.ok) throw new Error(`Failed to create conversation: ${response.status}`)
  const data = await response.json()
  return data.conversation
}

async function deleteConversation(id) {
  await fetch(`${API_URL}/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).catch(() => null)
}

async function clickAria(client, label) {
  await waitForEval(
    client,
    `[...document.querySelectorAll('button')]
      .some((button) => button.getAttribute('aria-label') === ${JSON.stringify(label)})`,
  )
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.getAttribute('aria-label') === ${JSON.stringify(label)});
      if (!button) throw new Error('Cannot find button: ${label}');
      button.click();
    })()`,
  )
}

async function selectConversation(client, title) {
  await waitForEval(
    client,
    `[...document.querySelectorAll('.conversation-title')]
      .some((item) => item.textContent.trim() === ${JSON.stringify(title)})`,
  )
  await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')]
        .find((item) => item.querySelector('.conversation-title')?.textContent.trim() === ${JSON.stringify(title)});
      const button = shell?.querySelector('.conversation-item');
      if (!button) throw new Error('Cannot find conversation: ${title}');
      button.click();
    })()`,
  )
  await waitForEval(
    client,
    `document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim() === ${JSON.stringify(title)}`,
  )
}

async function selectModelAndEffort(client, model, effort) {
  await clickSelector(client, '.model-menu-trigger')
  await clickAria(client, 'Select Model')
  await clickAria(client, `Select ${model.label}`)

  await clickSelector(client, '.model-menu-trigger')
  await clickAria(client, 'Select Effort')
  await clickAria(client, `Select Effort ${effort.label}`)

  await waitForEval(
    client,
    `(() => {
      const label = document.querySelector('.model-menu-trigger')?.getAttribute('aria-label') || '';
      return label.includes(${JSON.stringify(model.label)}) && label.endsWith(${JSON.stringify(`, ${effort.label}`)});
    })()`,
  )
}

const observeScript = `
(() => {
  const originalFetch = window.fetch.bind(window);
  window.__realModelAskRequests = [];
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const pathname = new URL(url, location.origin).pathname;
    if (/\\/api\\/conversations\\/[^/]+\\/ask$/.test(pathname)) {
      let body = null;
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch {}
      window.__realModelAskRequests.push({ pathname, body });
    }
    return originalFetch(input, init);
  };
})();
`

async function main() {
  const createdIds = new Set()
  const results = []
  const { chrome } = await launchChrome({
    url: 'about:blank',
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-model-options-real-',
    windowSize: '1280,900',
  })
  let client

  try {
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP_URL)}`, {
      method: 'PUT',
    })
    const target = await getPageTarget(DEBUG_PORT, APP_URL)
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: observeScript })

    for (const model of MODELS) {
      for (const effort of EFFORTS) {
        const slug = `${model.value}-${effort.value}`
        const title = `${TITLE_PREFIX}-${slug}`
        const marker = `MODELTEST-${STAMP}-${model.value}-${effort.value}`
        const conversation = await createConversation(title)
        createdIds.add(conversation.id)

        await client.send('Page.navigate', { url: APP_URL })
        await waitForEval(client, `Boolean(document.querySelector('.model-menu-trigger'))`)
        await selectConversation(client, title)
        await selectModelAndEffort(client, model, effort)

        const startedAt = Date.now()
        await ask(
          client,
          `真实模型参数测试。请判断“任意正整数 n，n(n+1) 都是偶数”是否成立。最终回答不超过两句话，并且必须包含标记 ${marker}。`,
        )
        await waitForEval(
          client,
          `(() => {
            const rows = [...document.querySelectorAll('.message-row.assistant')];
            const row = rows[rows.length - 1];
            const idle = Boolean(document.querySelector('button[aria-label="发送消息"]'));
            return idle && row && (row.innerText.includes(${JSON.stringify(marker)}) || row.querySelector('.error-text'));
          })()`,
          REAL_WAIT_TIMEOUT_MS,
        )

        const state = await evaluate(
          client,
          `(() => {
            const rows = [...document.querySelectorAll('.message-row.assistant')];
            const row = rows[rows.length - 1];
            const requests = window.__realModelAskRequests || [];
            return {
              answer: row?.innerText.trim() || '',
              error: row?.querySelector('.error-text')?.innerText.trim() || '',
              reasoning: row?.querySelector('.reasoning-content-body')?.textContent.trim() || '',
              request: requests[requests.length - 1] || null,
              triggerLabel: document.querySelector('.model-menu-trigger')?.getAttribute('aria-label') || '',
            };
          })()`,
        )

        const options = state.request?.body?.options
        const checks = {
          noUiError: !state.error,
          responseMarker: state.answer.includes(marker),
          requestModel: options?.model === model.value,
          reasoningEnabled: options?.reasoningEnabled === effort.enabled,
          reasoningEffort: !effort.enabled || options?.reasoningEffort === effort.value,
          reasoningPresence: effort.enabled ? state.reasoning.length > 0 : state.reasoning.length === 0,
        }
        const failures = Object.entries(checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name)

        results.push({
          model: model.value,
          effort: effort.value,
          passed: failures.length === 0,
          failures,
          checks,
          reasoningEnabled: effort.enabled,
          answerLength: state.answer.length,
          reasoningLength: state.reasoning.length,
          elapsedMs: Date.now() - startedAt,
          requestOptions: options,
          triggerLabel: state.triggerLabel,
        })
      }
    }

    console.log(JSON.stringify({
      ok: results.every((result) => result.passed),
      titlePrefix: TITLE_PREFIX,
      combinations: results,
    }, null, 2))
    const failed = results.filter((result) => !result.passed)
    if (failed.length > 0) {
      throw new Error(
        `Real model option assertions failed: ${failed.map((item) => `${item.model}/${item.effort}:${item.failures.join(',')}`).join('; ')}`,
      )
    }
  } finally {
    client?.close()
    await Promise.all([...createdIds].map(deleteConversation))
    await stopProcess(chrome)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
