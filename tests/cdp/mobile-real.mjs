import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { authenticateBrowser, createAuthenticatedFetch } from './helpers/authentication.mjs'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { screenshot, waitForEval } from './helpers/appActions.mjs'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const API_URL = new URL('/api/', APP_URL)
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9439)
const WAIT_MS = Number(process.env.CDP_REAL_WAIT_TIMEOUT_MS || 240_000)
const authenticatedFetch = createAuthenticatedFetch(APP_URL)
const prefix = `CDPMOBILEREAL-${Date.now()}`
const output = new URL('../../.tmp/cdp-mobile-real/', import.meta.url)

async function api(path, init) {
  const response = await authenticatedFetch(new URL(path, API_URL), init)
  assert.ok(response.ok, `API ${path} returned ${response.status}`)
  return response.status === 204 ? null : response.json()
}

async function tap(client, selector) {
  const point = await evaluate(client, `(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) throw new Error('Cannot tap '+${JSON.stringify(selector)});
    el.scrollIntoView({block:'nearest'});
    const r=el.getBoundingClientRect();
    if(r.width<2||r.height<2) throw new Error('Hidden tap target');
    return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, radiusX: 1, radiusY: 1, force: 1 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function type(client, value) {
  await evaluate(client, `(() => {
    const input=document.querySelector('.composer-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await waitForEval(client, `document.querySelector('.composer-input').value===${JSON.stringify(value)}`)
}

async function send(client, value) {
  const before = await evaluate(client, `document.querySelectorAll('.message-row.assistant').length`)
  await tap(client, '.composer-input')
  await type(client, value)
  await waitForEval(client, `document.querySelector('button[aria-label="发送消息"]')?.disabled===false`)
  await tap(client, 'button[aria-label="发送消息"]')
  await waitForEval(client, `document.querySelectorAll('.message-row.assistant').length===${before + 1} && document.querySelector('.composer-input').value===''`)
}

async function selectConversation(client, title) {
  await tap(client, '.sidebar-toggle')
  await waitForEval(client, `Boolean(document.querySelector('.workspace-sheet .conversation-item'))`)
  await evaluate(client, `(() => {
    const button=[...document.querySelectorAll('.conversation-item')].find(el=>el.querySelector('.conversation-title')?.textContent===${JSON.stringify(title)});
    if(!button)throw new Error('Missing test conversation');
    button.dataset.mobileRealTarget='true';
  })()`)
  await tap(client, '[data-mobile-real-target="true"]')
  await waitForEval(client, `!document.querySelector('.workspace-sheet') && document.querySelector('.chat-header h2')?.textContent===${JSON.stringify(title)} && !document.querySelector('.composer-input').disabled`)
}

async function completed(client, marker) {
  await waitForEval(client, `Boolean(document.querySelector('button[aria-label="发送消息"]')) && !document.querySelector('.stop-btn')`, WAIT_MS)
  assert.equal(await evaluate(client, `Boolean(document.querySelector('.message-row.assistant:last-child .error-text'))`), false)
  assert.equal(await evaluate(client, `document.querySelector('.message-row.assistant:last-child .markdown-message')?.textContent.includes(${JSON.stringify(marker)})`), true, `Completed real answer omitted expected marker: ${marker}`)
}

// Observe transport outcomes without replacing requests, responses or stream timing.
const observe = `(() => {
  const original=window.fetch.bind(window);
  window.__mobileReal={asks:[],patches:[],cancels:[]};
  window.fetch=(input,init={})=>{
    const pathname=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
    if(/\\/conversations\\/[^/]+\\/ask$/.test(pathname)) {
      const body=JSON.parse(init.body);
      const entry={requestId:body.requestId,question:body.question,options:body.options,aborted:false};
      window.__mobileReal.asks.push(entry);
      init.signal?.addEventListener('abort',()=>entry.aborted=true,{once:true});
    }
    const result=original(input,init);
    if(pathname.endsWith('/model-options') && init.method==='PATCH') {
      const entry={done:false,status:null}; window.__mobileReal.patches.push(entry);
      result.then(r=>{entry.status=r.status;entry.done=true},()=>{entry.status=0;entry.done=true});
    }
    if(/\\/requests\\/[^/]+\\/cancel$/.test(pathname)) {
      const entry={done:false,status:null,response:null}; window.__mobileReal.cancels.push(entry);
      result.then(async r=>{entry.status=r.status;entry.response=await r.clone().json();entry.done=true},()=>{entry.status=0;entry.done=true});
    }
    return result;
  };
})()`

async function main() {
  const ids = []
  const errors = []
  const assertions = {}
  let chrome
  let client
  try {
    for (const label of ['B', 'A']) {
      const { conversation } = await api('conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `${prefix}-${label}` }) })
      ids.push(conversation.id)
    }
    const [idB, idA] = ids
    ;({ chrome } = await launchChrome({ url: 'about:blank', debugPort: DEBUG_PORT, profilePrefix: 'chatbot-mobile-real-' }))
    client = new CdpClient((await getPageTarget(DEBUG_PORT, 'about:blank')).webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => errors.push(exceptionDetails.text))
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: observe })
    await client.send('Page.navigate', { url: APP_URL })
    await authenticateBrowser(client)
    await waitForEval(client, `document.querySelector('.mobile-model-trigger')?.disabled===false`)
    await selectConversation(client, `${prefix}-A`)

    await tap(client, '.mobile-model-trigger')
    await waitForEval(client, `Boolean(document.querySelector('.mobile-model-sheet'))`)
    if (await evaluate(client, `document.querySelector('input[value="deepseek:deepseek-v4-flash"]').checked`)) {
      await tap(client, 'label:has(input[value="deepseek:deepseek-v4-pro"])')
      await waitForEval(client, `document.querySelector('input[value="deepseek:deepseek-v4-pro"]').checked && !document.querySelector('.mobile-model-sheet-body').hasAttribute('aria-busy')`)
    }
    await tap(client, 'label:has(input[value="deepseek:deepseek-v4-flash"])')
    await waitForEval(client, `window.__mobileReal.patches.at(-1)?.done && window.__mobileReal.patches.at(-1).status===200 && !document.querySelector('.mobile-model-sheet-body').hasAttribute('aria-busy')`)
    await tap(client, 'label:has(input[value="off"])')
    await waitForEval(client, `document.querySelector('input[value="off"]').checked && !document.querySelector('.mobile-model-sheet-body').hasAttribute('aria-busy')`)
    const saved = (await api(`conversations/${idA}`)).conversation.modelOptions
    assert.equal(saved.model, 'deepseek-v4-flash')
    assert.equal(saved.reasoningEnabled, false)
    assertions.saved = { model: saved.model, reasoningEnabled: saved.reasoningEnabled }
    await tap(client, '.mobile-sheet-close')
    await waitForEval(client, `!document.querySelector('.mobile-model-sheet') && document.activeElement===document.querySelector('.mobile-model-trigger')`)

    const marker = `${prefix}-OK`
    await send(client, `测试手机聊天。请仅回复标记 ${marker}，不添加其他内容。`)
    await completed(client, marker)
    let stored = (await api(`conversations/${idA}`)).conversation
    assert.equal(stored.messages.length, 2)
    assert.ok(stored.messages[1].content.includes(marker))
    assert.equal(stored.messages[1].status, 'completed')
    assert.equal(stored.messages[1].generation.model, saved.model)
    assert.equal(await evaluate(client, `window.__mobileReal.asks[0].options.reasoningEnabled`), false)
    assertions.completedAndPersisted = true

    await send(client, '请逐行输出从 1 到 300 的编号清单，每行附上一句十个字以上的中文说明，不要省略任何编号。我会手动停止输出。')
    await waitForEval(client, `Boolean(document.querySelector('.stop-btn')) && Boolean(document.querySelector('.message-row.assistant:last-child .markdown-message')?.textContent.trim())`, WAIT_MS)
    const interruptedId = await evaluate(client, `window.__mobileReal.asks.at(-1).requestId`)
    await tap(client, '.stop-btn')
    await waitForEval(client, `window.__mobileReal.cancels.at(-1)?.done && Boolean(document.querySelector('button[aria-label="发送消息"]')) && !document.querySelector('.stop-btn') && window.__mobileReal.asks.at(-1).aborted`, WAIT_MS)
    assertions.cancel = await evaluate(client, `window.__mobileReal.cancels.at(-1)`)
    assert.equal(assertions.cancel.status, 200)
    assert.deepEqual(assertions.cancel.response, { cancelled: true, completed: true })
    const terminal = (await api(`requests/${interruptedId}`)).request
    assert.equal(terminal.status, 'stopped')
    stored = (await api(`conversations/${idA}`)).conversation
    assert.equal(stored.messages.length, 4)
    assert.equal(stored.messages[3].status, 'stopped')
    assert.ok(stored.messages[3].content.length > 0)
    assertions.stoppedPersisted = true

    const recovered = `${prefix}-RECOVERED`
    const recoveryQuestion = `停止后继续测试。请仅回复 ${recovered}。`
    await send(client, recoveryQuestion)
    assert.equal(await evaluate(client, `window.__mobileReal.asks.at(-1).question`), recoveryQuestion)
    await completed(client, recovered)
    stored = (await api(`conversations/${idA}`)).conversation
    assert.equal(stored.messages.length, 6)
    assert.equal(stored.messages[4].content, recoveryQuestion)
    assert.equal(stored.messages[3].status, 'stopped')
    assert.equal(stored.messages[5].status, 'completed')
    const before = JSON.stringify(stored.messages)
    await type(client, '这段草稿不能带去另一个会话')
    await selectConversation(client, `${prefix}-B`)
    assert.equal(await evaluate(client, `document.querySelector('.composer-input').value`), '')
    assert.equal((await api(`conversations/${idB}`)).conversation.messages.length, 0)
    await selectConversation(client, `${prefix}-A`)
    await waitForEval(client, `document.querySelectorAll('.message-row').length===6`)
    assert.equal(JSON.stringify((await api(`conversations/${idA}`)).conversation.messages), before)
    assertions.switchPreservedHistoryAndClearedDraft = true
    assert.equal(await evaluate(client, `window.__mobileReal.asks.length`), 3)

    const documentId = await evaluate(client, `window.__reloadMarker=crypto.randomUUID()`)
    await client.send('Page.reload')
    await waitForEval(client, `window.__reloadMarker!==${JSON.stringify(documentId)} && Boolean(document.querySelector('textarea')||document.querySelector('#auth-username'))`)
    await authenticateBrowser(client)
    await waitForEval(client, `document.querySelector('.mobile-model-trigger')?.disabled===false`)
    await selectConversation(client, `${prefix}-A`)
    await waitForEval(client, `document.querySelectorAll('.message-row').length===6`)
    await tap(client, '.mobile-model-trigger')
    await waitForEval(client, `document.querySelector('input[value="off"]')?.checked && document.querySelector('input[value="deepseek:deepseek-v4-flash"]')?.checked`)
    await tap(client, '.mobile-sheet-close')
    await waitForEval(client, `!document.querySelector('.mobile-model-sheet')`)
    assertions.refreshRestoredModelAndHistory = true
    assertions.layout = await evaluate(client, `(() => {
      const c=document.querySelector('.composer-inner').getBoundingClientRect();
      return {overflow:document.documentElement.scrollWidth>innerWidth,composerHeight:c.height,inside:c.left>=0&&c.right<=innerWidth&&c.bottom<=innerHeight,modelEntries:document.querySelectorAll('.model-menu-trigger').length};
    })()`)
    assert.deepEqual(assertions.layout, { overflow: false, composerHeight: 52, inside: true, modelEntries: 1 })
    assert.deepEqual(errors, [])
    assertions.consoleErrors = errors
    if (process.env.CDP_SCREENSHOTS === '1') {
      await mkdir(output, { recursive: true })
      await screenshot(client, output.pathname, 'mobile-real-completed', true)
    }
    console.log(JSON.stringify({ allPassed: true, provider: 'deepseek', model: saved.model, realRequests: 3, assertions }, null, 2))
  } catch (error) {
    if (client) {
      await mkdir(output, { recursive: true })
      await screenshot(client, output.pathname, 'failure', true)
    }
    throw error
  } finally {
    client?.close()
    await stopProcess(chrome)
    for (const id of ids) await api(`conversations/${id}`, { method: 'DELETE' })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
