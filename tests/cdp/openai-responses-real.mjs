import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { waitForEval } from './helpers/appActions.mjs'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { authenticateBrowser, createAuthenticatedFetch } from './helpers/authentication.mjs'
import { delay, stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const API_URL = new URL('/api', APP_URL).toString().replace(/\/$/, '')
const authenticatedFetch = createAuthenticatedFetch(APP_URL)
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9347)
const WAIT_TIMEOUT_MS = readPositiveInteger('CDP_REAL_OPENAI_WAIT_TIMEOUT_MS', 240000)
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const TITLE_PREFIX = `CDPOPENAIREAL-${STAMP}`
const MODEL = 'gpt-5.6-luna'
const EVIDENCE_DIR = process.env.CDP_REAL_OPENAI_EVIDENCE_DIR || path.resolve('.tmp/cdp-openai', STAMP)

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

async function createConversation(suffix) {
  const response = await authenticatedFetch(`${API_URL}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `${TITLE_PREFIX}-${suffix}` }),
  })
  if (!response.ok) throw new Error(`Failed to create conversation: ${response.status}`)
  return (await response.json()).conversation
}

async function deleteConversation(id) {
  await authenticatedFetch(`${API_URL}/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).catch(() => null)
}

async function readApi(resource) {
  const response = await authenticatedFetch(`${API_URL}/${resource}`)
  assert.equal(response.status, 200, `read ${resource}`)
  return response.json()
}

async function askApi(conversationId, question, options) {
  const response = await authenticatedFetch(`${API_URL}/conversations/${encodeURIComponent(conversationId)}/ask`, {
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
      .some((button) => {
        const rect = button.getBoundingClientRect();
        return button.getAttribute('aria-label') === ${JSON.stringify(label)} &&
          rect.width > 0 && rect.height > 0 && !button.disabled;
      })`,
  )
  await clickSelector(client, `button[aria-label=${JSON.stringify(label)}]`)
}

async function clickSelector(client, selector) {
  const point = await evaluate(
    client,
    `(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          const style = getComputedStyle(candidate);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
        });
      if (!element || element.disabled) return null;
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
  )
  if (!point) throw new Error(`Cannot click selector: ${selector}`)
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  })
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
    `[...document.querySelectorAll('.conversation-item-shell')]
      .some((item) => {
        const button = item.querySelector('.conversation-item');
        return item.querySelector('.conversation-title')?.textContent.trim() === ${JSON.stringify(title)} &&
          button && !button.disabled;
      })`,
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
  await waitForEval(client, `document.querySelector('.model-menu-trigger')?.disabled === false`)
  await clickSelector(client, '.model-menu-trigger')
  await waitForEval(client, `[...document.querySelectorAll('.model-options-menu')]
    .some((menu) => menu.getBoundingClientRect().height > 0)`)
  await waitForEval(client, `[...document.querySelectorAll('.model-submenu')]
    .some((menu) => menu.getBoundingClientRect().height > 0)`)
  await clickAria(client, '选择 GPT-5.6 Luna')
  await waitForEval(
    client,
    `document.querySelector('.model-menu-trigger')?.getAttribute('aria-label')
      ?.includes('GPT-5.6 Luna') && document.querySelector('.model-menu-trigger')?.disabled === false`,
  )
  await waitForEval(client, `![...document.querySelectorAll('.model-options-menu')]
    .some((menu) => menu.getBoundingClientRect().height > 0)`)
  await clickSelector(client, '.effort-menu-trigger')
  await waitForEval(client, `[...document.querySelectorAll('.effort-submenu')]
    .some((menu) => menu.getBoundingClientRect().height > 0)`)
  await clickAria(client, '思考强度 高')
  await waitForEval(
    client,
    `document.querySelector('.model-menu-trigger')?.getAttribute('aria-label')
      ?.includes('GPT-5.6 Luna') && document.querySelector('.effort-menu-trigger')?.getAttribute('aria-label') === '思考强度：高' &&
      document.querySelector('.model-menu-trigger')?.disabled === false &&
      ![...document.querySelectorAll('.effort-submenu')].some(menu => menu.getBoundingClientRect().height > 0)`,
  )
}

async function ask(client, question) {
  const before = await evaluate(client, `window.__openAiAskRequests.length`)
  await evaluate(client, `(() => {
    const input=document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(question)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await waitForEval(client, `document.querySelector('textarea').value===${JSON.stringify(question)} && document.querySelector('button[aria-label="发送消息"]')?.disabled===false`)
  await clickSelector(client, 'button[aria-label="发送消息"]')
  await waitForEval(client, `window.__openAiAskRequests.length===${before + 1}`)
}

const observeScript = `
(() => {
  const originalFetch = window.fetch.bind(window);
  window.__openAiAskRequests = [];
  window.__chatbotPerformanceDiagnostics = { enabled: true, marks: [] };
  window.__openAiAbortCount = 0;
  window.__openAiCancelResults = [];
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const pathname = new URL(url, location.origin).pathname;
    if (/\\/api\\/conversations\\/[^/]+\\/ask$/.test(pathname)) {
      let body = null;
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch {}
      window.__openAiAskRequests.push({ pathname, body, startedAt: performance.now() });
      init.signal?.addEventListener('abort', () => {
        window.__openAiAbortCount += 1;
      }, { once: true });
    }
    const response = originalFetch(input, init);
    if (/\\/api\\/requests\\/[^/]+\\/cancel$/.test(pathname)) {
      const entry={done:false,status:null,result:null};
      window.__openAiCancelResults.push(entry);
      response.then(async r=>{
        entry.status=r.status;
        entry.result=await r.clone().json();
        entry.done=true;
      }).catch(error=>{entry.error=error.name;entry.done=true;});
    }
    return response;
  };
})();
`

async function readSemanticTimings(client) {
  return evaluate(client, `window.__openAiAskRequests.map((request, index, requests) => {
    const events = window.__chatbotPerformanceDiagnostics.marks.filter(mark =>
      mark.name === 'stream-event' && mark.at >= request.startedAt &&
      mark.at < (requests[index + 1]?.startedAt ?? Infinity));
    const content = events.find(mark => mark.detail?.type === 'delta');
    return {
      requestId: request.body?.requestId,
      firstEventAfterMs: events.length ? Math.round(events[0].at - request.startedAt) : null,
      firstEventType: events[0]?.detail?.type ?? null,
      firstContentAfterMs: content ? Math.round(content.at - request.startedAt) : null,
      eventCount: events.length,
    };
  })`)
}

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
  let phase = 'setup'
  const network = new Map()

  try {
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP_URL)}`, {
      method: 'PUT',
    })
    const target = await getPageTarget(DEBUG_PORT, APP_URL)
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Network.enable')
    client.on('Network.requestWillBeSent', ({ requestId, request, timestamp }) => {
      if (!/\/api\/conversations\/[^/]+\/ask$/.test(new URL(request.url).pathname)) return
      network.set(requestId, { phase, startedAt: timestamp, chunks: 0, bytes: 0 })
    })
    client.on('Network.responseReceived', ({ requestId, response, timestamp }) => {
      const entry = network.get(requestId)
      if (entry) Object.assign(entry, { status: response.status, headersAfterMs: Math.round((timestamp-entry.startedAt)*1000) })
    })
    client.on('Network.dataReceived', ({ requestId, dataLength, timestamp }) => {
      const entry = network.get(requestId)
      if (!entry) return
      const elapsed = Math.round((timestamp-entry.startedAt)*1000)
      entry.firstDataAfterMs ??= elapsed
      entry.maxDataGapMs = Math.max(entry.maxDataGapMs ?? 0, elapsed-(entry.lastDataAfterMs ?? 0))
      entry.lastDataAfterMs = elapsed
      entry.chunks += 1
      entry.bytes += dataLength
    })
    for (const event of ['loadingFinished', 'loadingFailed']) {
      client.on(`Network.${event}`, ({ requestId, timestamp, errorText, canceled }) => {
        const entry = network.get(requestId)
        if (entry) Object.assign(entry, { terminal: event, endedAfterMs: Math.round((timestamp-entry.startedAt)*1000), errorText, canceled })
      })
    }
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: observeScript })
    await client.send('Page.navigate', { url: APP_URL })
    await authenticateBrowser(client)
    await waitForEval(client, `Boolean(document.querySelector('.model-menu-trigger'))`)

    await selectConversation(client, uiConversation.title)
    await selectOpenAiHigh(client)
    phase = 'streaming'
    const marker = `OPENAI-STREAM-${STAMP}`
    await ask(
      client,
      `请比较显式事件类型协议与纯文本协议在流式解析、错误恢复、工具调用和向后兼容四方面的取舍。请先分析约束再给出结论，用中文写四个短段落。最后一行必须原样输出 ${marker}。`,
    )
    await waitForEval(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].at(-1);
        const error = row?.querySelector('.error-text')?.textContent;
        if (error) throw new Error('OpenAI real stream failed: ' + error);
        return Boolean(row?.querySelector('.markdown-message[data-render-mode="streaming-lite"]')?.textContent.trim()) &&
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

    phase = 'tool'
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

    phase = 'stop'
    await selectConversation(client, stopConversation.title)
    await selectOpenAiHigh(client)
    await ask(
      client,
      '请连续写 100 个编号段落，每段至少 30 个汉字，用于真实中断测试。',
    )
    await waitForEval(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].at(-1);
        const markdown = row?.querySelector('.markdown-message[data-render-mode="streaming-lite"]');
        const error = row?.querySelector('.error-text')?.textContent;
        if (error) throw new Error('OpenAI stop precondition failed: ' + error);
        return Boolean(markdown?.textContent.trim()) &&
          Boolean(document.querySelector('button[aria-label="停止生成"]'));
      })()`,
      WAIT_TIMEOUT_MS,
    )
    await delay(100)
    const interruptedRequest = await evaluate(client, `window.__openAiAskRequests.at(-1).body`)
    assert.equal(interruptedRequest.options.provider, 'openai')
    assert.equal(interruptedRequest.options.model, MODEL)
    await clickAria(client, '停止生成')
    await waitForEval(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].at(-1);
        return row?.querySelector('.message-status-text')?.textContent.includes('已停止生成') &&
          Boolean(document.querySelector('button[aria-label="发送消息"]'));
      })()`,
      WAIT_TIMEOUT_MS,
    )
    const stoppedState = await evaluate(
      client,
      `(() => {
        const userRows = [...document.querySelectorAll('.message-row.user')];
        const assistantRows = [...document.querySelectorAll('.message-row.assistant')];
        const row = assistantRows.at(-1);
        return {
          abortCount: window.__openAiAbortCount,
          userRows: userRows.length,
          assistantRows: assistantRows.length,
          partialTextLength: row?.querySelector('.markdown-message')?.textContent.trim().length || 0,
          hasStopped: row?.querySelector('.message-status-text')?.textContent.includes('已停止生成') || false,
          hasRetry: [...(row?.querySelectorAll('button') || [])]
            .some((button) => button.textContent.trim() === '重试'),
        };
      })()`,
    )
    await waitForEval(client, `window.__openAiCancelResults.at(-1)?.done===true`)
    const cancellation = await evaluate(client, `window.__openAiCancelResults.at(-1)`)
    assert.equal(cancellation.status, 200)
    assert.deepEqual(cancellation.result, { cancelled: true, completed: true })
    const terminal = (await readApi(`requests/${interruptedRequest.requestId}`)).request
    assert.equal(terminal.status, 'stopped')
    const stoppedConversation = (await readApi(`conversations/${stopConversation.id}`)).conversation
    assert.equal(stoppedConversation.messages.length, 2)
    assert.equal(stoppedConversation.messages[1].status, 'stopped')
    assert.ok(stoppedConversation.messages[1].content.length>0)

    phase = 'recovery'
    const recoveryMarker = `OPENAI-RECOVERY-${STAMP}`
    await ask(client, `停止后恢复测试。请只回复 ${recoveryMarker}`)
    await waitForEval(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.assistant')].at(-1);
        const error = row?.querySelector('.error-text')?.textContent;
        if (error) throw new Error('OpenAI recovery failed: ' + error);
        return row?.querySelector('.message-text')?.textContent.includes(${JSON.stringify(recoveryMarker)}) &&
          Boolean(document.querySelector('button[aria-label="发送消息"]'));
      })()`,
      WAIT_TIMEOUT_MS,
    )
    const recoveredConversation = (await readApi(`conversations/${stopConversation.id}`)).conversation
    assert.equal(recoveredConversation.messages.length, 4)
    assert.equal(recoveredConversation.messages[1].status, 'stopped')
    assert.equal(recoveredConversation.messages[3].status, 'completed')
    assert.ok(recoveredConversation.messages[3].content.includes(recoveryMarker))

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
      stopPartialPersisted: stoppedState.userRows === 1 &&
        stoppedState.assistantRows === 1 && stoppedState.partialTextLength > 0,
      stopHasNoRetry: !stoppedState.hasRetry,
      recoverySucceeded: true,
    }
    const failures = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name)
    const semanticTimings = await readSemanticTimings(client)

    console.log(JSON.stringify({
      ok: failures.length === 0,
      checks,
      failures,
      evidence: {
        uiAnswerLength: uiState.answer.length,
        uiReasoningLength: uiState.reasoning.length,
        uiReasoningSummaryPresent: uiState.reasoning.length > 0,
        toolEventTypes: toolEvents.map((event) => event.type),
        stoppedState,
        cancellation,
        requestTerminal: terminal.status,
        network: [...network.values()],
        semanticTimings,
      },
    }, null, 2))

    if (failures.length > 0) {
      throw new Error(`OpenAI Responses real assertions failed: ${failures.join(', ')}`)
    }
    phase = 'completed'
    await mkdir(EVIDENCE_DIR, { recursive: true })
    await writeFile(path.join(EVIDENCE_DIR, 'network.json'), JSON.stringify({ ok: true, phase, network: [...network.values()], semanticTimings }, null, 2))
  } catch (error) {
    let browser
    try {
      browser = client && await evaluate(client, `({abortCount:window.__openAiAbortCount,requests:window.__openAiAskRequests?.map(r=>({requestId:r.body?.requestId,options:r.body?.options})),cancellations:window.__openAiCancelResults,errors:[...document.querySelectorAll('.error-text')].map(el=>el.textContent)})`)
    } catch (diagnosticError) {
      browser = { unavailable: diagnosticError.message }
    }
    let semanticTimings
    try {
      semanticTimings = client && await readSemanticTimings(client)
    } catch (diagnosticError) {
      semanticTimings = { unavailable: diagnosticError.message }
    }
    const diagnostic = { ok: false, phase, error: error.message, network: [...network.values()], semanticTimings, browser }
    await mkdir(EVIDENCE_DIR, { recursive: true })
    await writeFile(path.join(EVIDENCE_DIR, 'network.json'), JSON.stringify(diagnostic, null, 2))
    console.error(JSON.stringify(diagnostic, null, 2))
    throw error
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
