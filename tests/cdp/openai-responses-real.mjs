import { randomUUID } from 'node:crypto'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { ask, waitForEval } from './helpers/appActions.mjs'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { delay, stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const API_URL = new URL('/api', APP_URL).toString().replace(/\/$/, '')
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9347)
const WAIT_TIMEOUT_MS = readPositiveInteger('CDP_REAL_OPENAI_WAIT_TIMEOUT_MS', 240000)
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const TITLE_PREFIX = `CDPOPENAIREAL-${STAMP}`
const MODEL = 'gpt-5.6-luna'

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

async function createConversation(suffix) {
  const response = await fetch(`${API_URL}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `${TITLE_PREFIX}-${suffix}` }),
  })
  if (!response.ok) throw new Error(`Failed to create conversation: ${response.status}`)
  return (await response.json()).conversation
}

async function deleteConversation(id) {
  await fetch(`${API_URL}/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).catch(() => null)
}

async function askApi(conversationId, question, options) {
  const response = await fetch(`${API_URL}/conversations/${encodeURIComponent(conversationId)}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, requestId: randomUUID(), options }),
  })
  if (!response.ok || !response.body) {
    throw new Error(`OpenAI ask failed: ${response.status} ${await response.text()}`)
  }

  const events = []
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) events.push(JSON.parse(line))
    }
    if (done) break
  }

  if (buffer.trim()) events.push(JSON.parse(buffer))
  return events
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
    `document.querySelector('.conversation-item-shell.active .conversation-title')
      ?.textContent.trim() === ${JSON.stringify(title)}`,
  )
  await waitForEval(client, `Boolean(document.querySelector('textarea:not([disabled])'))`)
}

async function selectOpenAiHigh(client) {
  await clickSelector(client, '.model-menu-trigger')
  await clickAria(client, 'Select Model')
  await clickAria(client, 'Select GPT-5.6 Luna')
  await clickSelector(client, '.model-menu-trigger')
  await clickAria(client, 'Select Effort')
  await clickAria(client, 'Select Effort High')
  await waitForEval(
    client,
    `document.querySelector('.model-menu-trigger')?.getAttribute('aria-label')
      ?.includes('GPT-5.6 Luna, High')`,
  )
}

const observeScript = `
(() => {
  const originalFetch = window.fetch.bind(window);
  window.__openAiAskRequests = [];
  window.__openAiAbortCount = 0;
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const pathname = new URL(url, location.origin).pathname;
    if (/\\/api\\/conversations\\/[^/]+\\/ask$/.test(pathname)) {
      let body = null;
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch {}
      window.__openAiAskRequests.push({ pathname, body });
      init.signal?.addEventListener('abort', () => {
        window.__openAiAbortCount += 1;
      }, { once: true });
    }
    return originalFetch(input, init);
  };
})();
`

async function main() {
  const createdIds = new Set()
  const uiConversation = await createConversation('stream-reasoning')
  createdIds.add(uiConversation.id)
  const toolConversation = await createConversation('tool')
  createdIds.add(toolConversation.id)
  const stopConversation = await createConversation('stop-recovery')
  createdIds.add(stopConversation.id)

  const { chrome } = await launchChrome({
    url: 'about:blank',
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-openai-responses-real-',
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
    await client.send('Page.navigate', { url: APP_URL })
    await waitForEval(client, `Boolean(document.querySelector('.model-menu-trigger'))`)

    await selectConversation(client, uiConversation.title)
    await selectOpenAiHigh(client)
    const marker = `OPENAI-STREAM-${STAMP}`
    await ask(
      client,
      `请比较显式事件类型协议与纯文本协议在流式解析、错误恢复、工具调用和向后兼容四方面的取舍。请先分析约束再给出结论，用中文写四个短段落。最后一行必须原样输出 ${marker}。`,
    )
    await waitForEval(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].at(-1);
        return Boolean(row?.querySelector('.message-text')?.textContent.trim()) &&
          Boolean(document.querySelector('button[aria-label="停止生成"]'));
      })()`,
      WAIT_TIMEOUT_MS,
    )
    const streamingMid = await evaluate(
      client,
      `Boolean(document.querySelector('button[aria-label="停止生成"]'))`,
    )
    await waitForEval(client, `Boolean(document.querySelector('button[aria-label="发送消息"]'))`, WAIT_TIMEOUT_MS)
    const uiState = await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].at(-1);
        const request = (window.__openAiAskRequests || []).at(-1);
        return {
          answer: row?.querySelector('.message-text')?.textContent.trim() || '',
          reasoning: row?.querySelector('.reasoning-content-body')?.textContent.trim() || '',
          error: row?.querySelector('.error-text')?.textContent.trim() || '',
          options: request?.body?.options || null,
        };
      })()`,
    )

    const toolEvents = await askApi(
      toolConversation.id,
      '必须调用 calculate 工具计算 (12345 * 67) + 89，然后用一句中文给出结果。不要自行心算。',
      {
        provider: 'openai',
        model: MODEL,
        reasoningEnabled: true,
        reasoningEffort: 'medium',
        maxTokens: 1024,
      },
    )
    const toolStart = toolEvents.find((event) => event.type === 'tool_start')
    const toolResult = toolEvents.find((event) => event.type === 'tool_result')
    const toolAnswer = toolEvents
      .filter((event) => event.type === 'delta')
      .map((event) => event.content || '')
      .join('')

    await selectConversation(client, stopConversation.title)
    await ask(
      client,
      '请连续写 100 个编号段落，每段至少 30 个汉字，用于真实中断测试。',
    )
    await waitForEval(client, `Boolean(document.querySelector('button[aria-label="停止生成"]'))`, WAIT_TIMEOUT_MS)
    await delay(500)
    await clickAria(client, '停止生成')
    await waitForEval(client, `document.body.innerText.includes('已停止生成')`, WAIT_TIMEOUT_MS)
    await waitForEval(client, `Boolean(document.querySelector('button[aria-label="发送消息"]'))`, WAIT_TIMEOUT_MS)
    const stoppedState = await evaluate(
      client,
      `({
        abortCount: window.__openAiAbortCount,
        hasStopped: document.body.innerText.includes('已停止生成'),
      })`,
    )

    const recoveryMarker = `OPENAI-RECOVERY-${STAMP}`
    await ask(client, `停止后恢复测试。请只回复 ${recoveryMarker}`)
    await waitForEval(
      client,
      `[...document.querySelectorAll('.message-row.assistant')]
        .some((row) => row.textContent.includes(${JSON.stringify(recoveryMarker)})) &&
        Boolean(document.querySelector('button[aria-label="发送消息"]'))`,
      WAIT_TIMEOUT_MS,
    )

    const checks = {
      uiStreamingObserved: streamingMid,
      uiNoError: !uiState.error,
      uiMarker: uiState.answer.includes(marker),
      reasoningRequested: uiState.options?.reasoningEnabled === true,
      requestProvider: uiState.options?.provider === 'openai',
      requestModel: uiState.options?.model === MODEL,
      requestEffort: uiState.options?.reasoningEffort === 'high',
      unsupportedTemperatureOmitted: !Object.hasOwn(uiState.options || {}, 'temperature'),
      toolStarted: toolStart?.name === 'calculate',
      toolSucceeded: toolResult?.name === 'calculate' && toolResult?.success === true,
      toolResultCorrect: String(toolResult?.summary || '').includes('827204'),
      toolAnswerCorrect: toolAnswer.includes('827204'),
      toolDone: toolEvents.at(-1)?.type === 'done',
      stopAbortedFetch: stoppedState.abortCount > 0,
      stopStateVisible: stoppedState.hasStopped,
      recoverySucceeded: true,
    }
    const failures = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name)

    console.log(JSON.stringify({
      ok: failures.length === 0,
      checks,
      failures,
      evidence: {
        uiAnswerLength: uiState.answer.length,
        uiReasoningLength: uiState.reasoning.length,
        uiReasoningSummaryPresent: uiState.reasoning.length > 0,
        toolEventTypes: toolEvents.map((event) => event.type),
        abortCount: stoppedState.abortCount,
      },
    }, null, 2))

    if (failures.length > 0) {
      throw new Error(`OpenAI Responses real assertions failed: ${failures.join(', ')}`)
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
