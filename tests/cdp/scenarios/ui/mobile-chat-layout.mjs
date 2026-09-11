import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { ask, evaluate, runScenarioModule, seedConversations, setMockFlags, setPlan, setRuntimeConfiguration, typeText, waitFor, waitIdle } from './harness.mjs'

const output = new URL('../../../../.tmp/mobile-ui/', import.meta.url)
const answer = '### 它们分工不同，但可以配合使用\n\nFunction Calling 让模型决定调用什么；MCP 让应用用统一协议连接工具和数据。\n\n### 一次工具调用的过程\n\n1. 模型选择工具，并生成参数。\n2. 应用通过 MCP 调用对应服务。\n3. 工具结果回传模型，生成最终回答。\n\n简单说：一个负责**决定**，一个负责**连接**。'
const fixture = [
  { id: 'mobile-ui-mcp', title: 'MCP 与 Function Calling 的完整对照和调用流程', updatedAt: '2026-09-07T04:00:00Z', modelOptions: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEnabled: true, reasoningEffort: 'high' }, messages: [
    { role: 'user', content: 'MCP 和 Function Calling 有什么关系？' },
    { role: 'assistant', content: answer, reasoningContent: '先区分职责，再说明一次工具调用的流程。', reasoningDurationMs: 8000 },
    { role: 'user', content: '能举个查询天气的例子吗？' },
    { role: 'assistant', content: '模型先确定城市，再调用天气工具，最后把查询结果整理成回答。' },
  ] },
  { id: 'mobile-ui-other', title: '移动端测试的另一个会话', updatedAt: '2026-09-07T03:00:00Z', messages: [{ role: 'user', content: '第二个会话' }, { role: 'assistant', content: '保持会话独立。' }] },
]

async function settle(client) {
  await evaluate(client, `document.fonts.ready.then(() => true)`)
  await waitFor(client, `!document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime))`)
}

async function reload(client, ready) {
  const marker = await evaluate(client, `window.__mobileDocumentMarker=crypto.randomUUID()`)
  await client.send('Page.reload')
  await waitFor(client, `window.__mobileDocumentMarker!==${JSON.stringify(marker)} && (${ready})`)
  await settle(client)
}

async function tap(client, selector) {
  const point = await evaluate(client, `(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Missing '+${JSON.stringify(selector)});
    el.scrollIntoView({block:'nearest'});
    const r=el.getBoundingClientRect();
    if (r.width<2||r.height<2) throw new Error('Hidden '+${JSON.stringify(selector)});
    return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, radiusX: 1, radiusY: 1, force: 1 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function key(client, value) {
  const windowsVirtualKeyCode = { Tab: 9, Escape: 27, ArrowLeft: 37, ArrowRight: 39 }[value]
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: value, windowsVirtualKeyCode })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code: value, windowsVirtualKeyCode })
}

async function capture(client, name, failure = false) {
  if (!failure && process.env.CDP_SCREENSHOTS !== '1') return
  await mkdir(output, { recursive: true })
  await settle(client)
  const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(new URL(`${name}.png`, output), Buffer.from(shot.data, 'base64'))
}

async function metrics(client, width, height = 844) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 820 })
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: width <= 820 })
  await waitFor(client, `Math.abs(document.querySelector('.app-shell').getBoundingClientRect().height-${height})<2`)
  await settle(client)
}

async function layout(client) {
  return evaluate(client, `(() => {
    const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    const composer=rect('.composer-inner'), input=rect('.composer-input'), send=rect('.send-btn'), plus=rect('.composer-plus-btn'), header=rect('.chat-header');
    return {composer,input,send,plus,header,model:rect('.model-menu-trigger'),
      overflow:document.documentElement.scrollWidth>innerWidth,
      bodyFont:getComputedStyle(document.querySelector('.message-row.assistant .message-text')).fontSize,
      modelCount:document.querySelectorAll('.model-menu-trigger').length,
      composerModels:document.querySelectorAll('.composer .model-menu-trigger, .composer .effort-menu-trigger').length,
      border:getComputedStyle(document.querySelector('.composer-inner')).borderWidth,
      plusBorder:getComputedStyle(document.querySelector('.composer-plus-btn')).borderWidth,
      sendVisual:send.width-2*parseFloat(getComputedStyle(document.querySelector('.send-btn')).borderWidth),
      draft:document.querySelector('textarea').value,
      inputFont:getComputedStyle(document.querySelector('textarea')).fontSize,
      inputMaxHeight:parseFloat(getComputedStyle(document.querySelector('textarea')).maxHeight),
      visibleTitle:document.querySelector('.chat-header h2').getBoundingClientRect().width>1,
      headerOverlaps:rect('.model-menu-trigger').right>rect('.header-new-chat').x+.5,
      userBg:getComputedStyle(document.querySelector('.message-row.user .message-text')).backgroundColor};
  })()`)
}

export async function runMobileChatLayout(client) {
  const results = { viewports: {} }
  const errors = []
  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => errors.push(exceptionDetails.text))
  try {
    await seedConversations(client, fixture)
    for (const theme of ['dark', 'light']) {
      await evaluate(client, `localStorage.setItem('chatbot-theme',${JSON.stringify(theme)})`)
      await reload(client, `document.querySelectorAll('.message-row').length===4 && !document.querySelector('textarea').disabled`)
      for (const width of [320, 375, 390, 430, 768, 820]) {
        await metrics(client, width)
        await tap(client, '.composer-input')
        await typeText(client, '用北京举例')
        await settle(client)
        const state = await layout(client)
        assert.equal(state.overflow, false)
        assert.equal(state.bodyFont, '14px')
        assert.equal(state.inputFont, '16px')
        assert.equal(state.inputMaxHeight, 144)
        assert.equal(state.header.height, 52)
        assert.equal(state.composer.height, 52)
        assert.equal(state.border, '0px')
        assert.equal(state.plusBorder, '0px')
        assert.equal(state.sendVisual, 32)
        assert.equal(state.visibleTitle, false)
        assert.equal(state.headerOverlaps, false)
        assert.equal(state.modelCount, 1)
        assert.equal(state.composerModels, 0)
        assert.ok(state.composer.bottom <= 844 && state.composer.x >= 0 && state.composer.right <= width)
        assert.ok(state.input.x >= state.plus.right && state.input.right <= state.send.x)
        assert.equal(state.plus.height, 44)
        assert.equal(state.send.height, 44)
        assert.ok(Math.abs(state.input.y+state.input.height/2-state.send.y-state.send.height/2)<1)
        if (theme === 'light') {
          const dark = results.viewports[`dark-${width}`]
          for (const part of ['composer', 'input', 'send', 'plus', 'header', 'model']) assert.deepEqual(state[part], dark[part], `Theme changed ${part}`)
          assert.equal(state.userBg, 'rgb(24, 24, 24)')
        }
        results.viewports[`${theme}-${width}`] = state
        await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: 220, deltaX: 0, deltaY: -5000 })
        await waitFor(client, `document.querySelector('.chat-scroll').scrollTop===0`)
        // CDP wheel gestures can leave a compositor-only overscroll animation on macOS.
        await delay(600)
        assert.ok(await evaluate(client, `document.querySelector('.message-row').getBoundingClientRect().top<100`))
        await capture(client, `chat-${theme}-${width}`)
      }
      if (theme === 'dark') {
        await metrics(client, 390)
        await tap(client, '.mobile-model-trigger')
        await waitFor(client, `Boolean(document.querySelector('.mobile-model-sheet'))`)
        await capture(client, 'model-sheet-dark')
        await tap(client, '.mobile-sheet-close')
        await waitFor(client, `!document.querySelector('.mobile-model-sheet')`)
      }
    }

    await metrics(client, 390)
    await tap(client, '.mobile-model-trigger')
    await waitFor(client, `Boolean(document.querySelector('.mobile-model-sheet'))`)
    await settle(client)
    results.sheet = await evaluate(client, `(() => {
      const sheet=document.querySelector('.mobile-model-sheet'), r=sheet.getBoundingClientRect(), list=sheet.querySelector('.mobile-model-list');
      const option=sheet.querySelector('.mobile-model-choice:not([data-unavailable="true"])');
      return {inside:r.left===0&&r.right===innerWidth&&r.bottom<=innerHeight&&r.top>=52,width:r.width,
        selected:list.querySelectorAll('input:checked').length, disabled:sheet.querySelector('input[value="openai:gpt-5.6-sol"]').disabled,
        heading:parseFloat(getComputedStyle(sheet.querySelector('.submenu-heading')).fontSize),option:parseFloat(getComputedStyle(option).fontSize),
        modelColor:getComputedStyle(option).color,effortColor:getComputedStyle(sheet.querySelector('.mobile-effort-choice')).color,
        focus:sheet.contains(document.activeElement),menus:document.querySelectorAll('[role="menu"]').length};
    })()`)
    assert.equal(results.sheet.inside, true)
    assert.equal(results.sheet.selected, 1)
    assert.equal(results.sheet.disabled, true)
    assert.equal(results.sheet.menus, 0)
    assert.equal(results.sheet.focus, true)
    assert.ok(results.sheet.heading < results.sheet.option)
    assert.equal(results.sheet.modelColor, results.sheet.effortColor)
    await capture(client, 'model-sheet-light')
    for (let i = 0; i < 6; i += 1) {
      await key(client, 'Tab')
      await waitFor(client, `document.querySelector('.mobile-model-sheet').contains(document.activeElement) && !document.activeElement.disabled`)
    }

    await setMockFlags(client, { modelOptionsDelayMs: 300 })
    await tap(client, 'label:has(input[value="deepseek:deepseek-v4-pro"])')
    await waitFor(client, `document.querySelector('.mobile-model-sheet-body').getAttribute('aria-busy')==='true'`)
    assert.equal(await evaluate(client, `[...document.querySelectorAll('.mobile-model-sheet input')].every(i=>i.disabled)`), true)
    await waitFor(client, `!document.querySelector('.mobile-model-sheet-body').hasAttribute('aria-busy')`)
    await tap(client, 'label:has(input[aria-label="思考强度 最高"])')
    await waitFor(client, `window.__getMockState().conversations.find(c=>c.id==='mobile-ui-mcp').modelOptions.reasoningEffort==='max' && !document.querySelector('.mobile-model-sheet-body').hasAttribute('aria-busy')`)
    results.saved = await evaluate(client, `window.__getMockState().conversations.find(c=>c.id==='mobile-ui-mcp').modelOptions`)
    assert.equal(results.saved.model, 'deepseek-v4-pro')
    assert.equal(results.saved.reasoningEffort, 'max')
    await evaluate(client, `document.querySelector('input[aria-label="思考强度 最高"]').focus()`)
    await key(client, 'ArrowLeft')
    await waitFor(client, `document.querySelector('input[aria-label="思考强度 高"]').checked && !document.querySelector('.mobile-model-sheet-body').hasAttribute('aria-busy')`)
    await evaluate(client, `document.querySelector('input[aria-label="思考强度 高"]').focus()`)
    await key(client, 'ArrowRight')
    await waitFor(client, `document.querySelector('input[aria-label="思考强度 最高"]').checked && !document.querySelector('.mobile-model-sheet-body').hasAttribute('aria-busy')`)
    results.keyboardSelection = true
    await tap(client, '.mobile-sheet-close')
    await waitFor(client, `!document.querySelector('.mobile-model-sheet')`)
    assert.equal(await evaluate(client, `document.activeElement===document.querySelector('.mobile-model-trigger')`), true)
    assert.equal(await evaluate(client, `document.querySelector('textarea').value`), '用北京举例')
    await reload(client, `document.querySelector('.mobile-model-trigger')?.textContent.includes('DeepSeek V4 Pro') && !document.querySelector('.mobile-model-trigger').disabled`)
    await tap(client, '.mobile-model-trigger')
    await waitFor(client, `document.querySelector('input[aria-label="思考强度 最高"]')?.checked`)

    await setMockFlags(client, { failNextModelOptions: true })
    await tap(client, 'label:has(input[value="deepseek:deepseek-v4-flash"])')
    await waitFor(client, `Boolean(document.querySelector('.app-dialog'))`)
    assert.equal(await evaluate(client, `document.querySelector('input[value="deepseek:deepseek-v4-pro"]').checked`), true)
    await tap(client, '.app-dialog .modal-btn')
    await waitFor(client, `!document.querySelector('.app-dialog') && !document.querySelector('.mobile-model-sheet-body').hasAttribute('aria-busy')`)
    await setMockFlags(client, { modelOptionsDelayMs: 0 })
    await tap(client, 'label:has(input[value="deepseek:deepseek-v4-flash-vision-exp"])')
    await waitFor(client, `!document.querySelector('.mobile-model-sheet-body').hasAttribute('aria-busy') && document.querySelector('input[value="deepseek:deepseek-v4-flash-vision-exp"]').checked`)
    await key(client, 'Escape')
    await waitFor(client, `!document.querySelector('.mobile-model-sheet')`)
    await metrics(client, 320)
    assert.equal((await layout(client)).headerOverlaps, false)
    await capture(client, 'long-model-320')
    results.saveFailureRecovery = true

    await typeText(client, '不能带去另一个会话的草稿')
    await tap(client, '.sidebar-toggle')
    await waitFor(client, `Boolean(document.querySelector('.workspace-sheet .sidebar'))`)
    assert.equal(await evaluate(client, `document.querySelector('.workspace-sheet').getBoundingClientRect().width`), 320)
    assert.equal(await evaluate(client, `document.querySelector('.workspace-sheet').contains(document.activeElement)`), true)
    await capture(client, 'conversation-list-320')
    await tap(client, '.conversation-item:not([aria-current])')
    await waitFor(client, `!document.querySelector('.workspace-sheet') && document.querySelector('.chat-header h2').textContent.includes('另一个会话')`)
    assert.equal(await evaluate(client, `document.querySelector('textarea').value`), '')
    await tap(client, '.composer-plus-btn')
    await waitFor(client, `Boolean(document.querySelector('.mobile-template-item'))`)
    await tap(client, '.mobile-template-item')
    await waitFor(client, `Boolean(document.querySelector('.template-modal'))`)
    await key(client, 'Escape')
    await waitFor(client, `!document.querySelector('.template-modal')`)
    results.conversationSwitch = true
    results.templateAccess = true

    await metrics(client, 390, 460)
    await tap(client, '.mobile-model-trigger')
    await waitFor(client, `Boolean(document.querySelector('.mobile-model-sheet'))`)
    await settle(client)
    results.shortSheet = await evaluate(client, `(() => {
      const sheet=document.querySelector('.mobile-model-sheet'), r=sheet.getBoundingClientRect(), body=sheet.querySelector('.mobile-model-sheet-body');
      return {inside:r.top>=52&&r.bottom<=innerHeight,scrolls:body.scrollHeight>body.clientHeight,closeVisible:sheet.querySelector('.mobile-sheet-close').getBoundingClientRect().bottom<=innerHeight};
    })()`)
    assert.deepEqual(results.shortSheet, { inside: true, scrolls: true, closeVisible: true })
    await capture(client, 'short-viewport-sheet')
    await tap(client, '.mobile-sheet-close')
    await waitFor(client, `!document.querySelector('.mobile-model-sheet')`)
    await tap(client, '.composer-input')
    await typeText(client, Array.from({ length: 15 }, (_, i) => `多行输入 ${i}`).join('\n'))
    await settle(client)
    results.shortViewport = await layout(client)
    assert.ok(results.shortViewport.input.height <= 96)
    assert.equal(results.shortViewport.inputMaxHeight, 96)
    assert.equal(results.shortViewport.inputFont, '16px')
    assert.ok(results.shortViewport.composer.bottom <= 460)
    assert.ok(results.shortViewport.composer.y > results.shortViewport.header.bottom)
    assert.equal(results.shortViewport.overflow, false)
    await capture(client, 'short-viewport-draft')
    await setPlan(client, [{ kind: 'success', firstDelay: 100, chunks: ['正在输出。'], done: false, interval: 100 }])
    await typeText(client, '移动端停止回归')
    await tap(client, '.send-btn')
    await waitFor(client, `document.querySelector('.message-row.assistant:last-child')?.textContent.includes('正在输出')`)
    await setMockFlags(client, { cancelDelayMs: 400 })
    await tap(client, '.stop-btn')
    await waitFor(client, `document.querySelector('button[aria-label="正在停止生成"]')?.disabled`)
    await waitIdle(client)
    results.cancel = await evaluate(client, `({aborts:window.__abortCount,cancels:window.__cancelCount,completed:window.__cancelCompletedCount,draft:document.querySelector('textarea').value})`)
    assert.deepEqual(results.cancel, { aborts: 1, cancels: 1, completed: 1, draft: '' })
    await setPlan(client, [{ kind: 'success', chunks: ['停止后可以再次发送。'], interval: 10 }])
    await ask(client, '停止后的恢复')
    await waitFor(client, `document.body.textContent.includes('停止后可以再次发送。')`)
    await waitIdle(client)

    await metrics(client, 390)
    const runtime = await evaluate(client, `fetch('/api/runtime-config').then(r=>r.json()).then(r=>r.runtime)`)
    await setRuntimeConfiguration(client, { ...runtime, providers: [] })
    await reload(client, `document.querySelector('.mobile-model-trigger')?.textContent.includes('模型不可用') && !document.querySelector('textarea').disabled`)
    await typeText(client, '目录不可用时仍可编辑')
    assert.equal(await evaluate(client, `document.querySelector('.mobile-model-trigger').disabled && document.querySelector('.send-btn').disabled && !document.querySelector('textarea').disabled`), true)
    assert.equal(await evaluate(client, `window.__askCount`), 0)
    await setRuntimeConfiguration(client, runtime)
    await reload(client, `document.querySelector('.mobile-model-trigger') && !document.querySelector('.mobile-model-trigger').disabled`)
    results.catalogFailClosed = true

    await metrics(client, 1440, 1000)
    assert.equal(await evaluate(client, `Boolean(document.querySelector('.composer .model-menu-trigger')) && !document.querySelector('.mobile-model-trigger')`), true)
    assert.equal(await evaluate(client, `document.documentElement.style.getPropertyValue('--chat-viewport-height')`), '')
    await metrics(client, 390)
    await tap(client, '.header-new-chat')
    await waitFor(client, `Boolean(document.querySelector('.empty-state')) && !document.querySelector('textarea').disabled`)
    results.empty = await evaluate(client, `(() => {const r=document.querySelector('.composer-inner').getBoundingClientRect();return {height:r.height,bottom:r.bottom,draft:document.querySelector('textarea').value,disabled:document.querySelector('.send-btn').disabled}})()`)
    assert.deepEqual(results.empty, { height: 52, bottom: 832, draft: '', disabled: true })
    await capture(client, 'empty-light')
    assert.deepEqual(errors, [])
    results.consoleErrors = errors
    await mkdir(output, { recursive: true })
    await writeFile(new URL('results.json', output), JSON.stringify(results, null, 2))
    return results
  } catch (error) {
    await capture(client, 'failure', true)
    throw error
  } finally {
    await seedConversations(client, [])
  }
}

runScenarioModule(import.meta.url, 'mobile-chat-layout', runMobileChatLayout)
