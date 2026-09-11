import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { ask, evaluate, runScenarioModule, seedConversations, setPlan, typeText, waitFor, waitIdle } from './harness.mjs'

const output = new URL('../../../../.tmp/ui-refresh/', import.meta.url)
const answer = '### 两者分工不同，可以配合使用\n\nFunction Calling 让模型决定调用什么；MCP 让应用用统一协议连接工具和数据。\n\n### 一次工具调用的过程\n\n1. 模型选择工具，并生成参数。\n2. 应用通过 MCP 调用对应服务。\n3. 工具结果回传模型，生成最终回答。\n\n| 维度 | Function Calling | MCP |\n| --- | --- | --- |\n| 关注点 | 让模型选择调用什么 | 让应用知道怎样连接工具 |\n| 作用范围 | 模型内部的一次调用决策 | 应用与外部服务连接 |\n| 执行方 | 应用处理工具调用 | 应用（通过 MCP 客户端） |\n\n**结论：** 两者协同，才能稳定可靠地完成工具调用。'

async function settle(client) {
  await evaluate(client, `document.fonts.ready.then(() => true)`)
  await waitFor(client, `!document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime))`)
}

async function click(client, selector) {
  const point = await evaluate(client, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
    el.scrollIntoView({block:'nearest'});
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) throw new Error('Hidden control: ' + ${JSON.stringify(selector)});
    return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`)
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
}

async function escape(client) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
  await settle(client)
}

async function hoverTooltip(client, selector) {
  const point = await evaluate(client, `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await waitFor(client, `Boolean(document.querySelector('[data-slot="tooltip-label"]'))`)
  await settle(client)
  const tooltip = await evaluate(client, `(() => {
    const el=document.querySelector('.icon-tooltip'), label=el.querySelector('[data-slot="tooltip-label"]'), r=el.getBoundingClientRect(), l=label.getBoundingClientRect();
    return {text:label.textContent,inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,labelInside:l.left>=r.left&&l.right<=r.right&&l.top>=r.top&&l.bottom<=r.bottom,arrows:el.querySelectorAll('svg').length};
  })()`)
  assert.ok(tooltip.text)
  assert.equal(tooltip.inside, true)
  assert.equal(tooltip.labelInside, true)
  assert.equal(tooltip.arrows, 0)
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
  await waitFor(client, `!document.querySelector('.icon-tooltip')`)
  return tooltip
}

async function installContextFixture(client) {
  await evaluate(client, `(() => {
    const originalFetch=window.fetch.bind(window);
    window.fetch=(input, init={}) => {
      const url=new URL(typeof input==='string'?input:input.url, location.origin);
      if (!url.pathname.endsWith('/context-preview')) return originalFetch(input,init);
      const request=JSON.parse(init.body);
      return Promise.resolve(new Response(JSON.stringify({context:{
        conversationId:url.pathname.split('/').at(-2),question:request.question,
        messages:[{role:'user',content:request.question || 'MCP 和 Function Calling 有什么关系？'}],
        stats:{totalHistoryMessages:2,summaryCoveredMessages:0,postSummaryMessages:2,excludedStoppedMessages:0,selectedHistoryMessages:2,droppedHistoryMessages:0,selectedHistoryChars:1000,selectedHistoryRange:{start:1,end:2},maxHistoryMessages:20,maxHistoryChars:20000,maxImages:4,selectedImages:0,droppedImages:0,selectedImageBytes:0,summaryIncluded:false,summaryDroppedByTokenBudget:false,legacyDroppedHistoryMessages:0,tokenDroppedHistoryMessages:0,estimatedInputTokens:2048,outputReserveTokens:4096,estimatedTotalTokens:6144,contextWindowTokens:131072,remainingInputTokens:124928,estimator:'deepseek-utf8-conservative-v1',tokenBreakdown:{system:84,summary:0,history:128,currentQuestion:34,images:0,tools:1214,framing:32,toolContinuationReserve:556}},
        model:{provider:'deepseek',model:'deepseek-v4-flash',endpointConfigured:true,apiKeyConfigured:true,reasoningEnabled:true,reasoningEffort:'high',stream:true,toolChoice:'auto',storageBackend:'file',temperature:null,maxTokens:null,contextWindowTokens:131072},
        tools:{count:0,definitions:[]}
      }}),{headers:{'Content-Type':'application/json'}}));
    };
    return true;
  })()`)
}

async function capture(client, name, failure = false) {
  if (!failure && process.env.CDP_SCREENSHOTS !== '1') return
  await mkdir(output, { recursive: true })
  await settle(client)
  const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(new URL(`${name}.png`, output), Buffer.from(shot.data, 'base64'))
}

async function geometry(client) {
  return evaluate(client, `(() => {
    const box = (s) => {const r=document.querySelector(s)?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom} : null};
    return {composer:box('.composer-inner'),messages:box('.message-list'),header:box('.chat-header'),sidebar:box('.sidebar'),overflow:document.documentElement.scrollWidth>innerWidth,bodyFont:getComputedStyle(document.querySelector('.message-row.assistant .message-text') || document.querySelector('textarea')).fontSize};
  })()`)
}

export async function runWorkspaceLayout(client) {
  const results = {}
  const errors = []
  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => errors.push(exceptionDetails.text))
  try {
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    await seedConversations(client, [
      { id: 'ui-refresh-mcp', title: 'MCP 与 Function Calling', messages: [{ role: 'user', content: 'MCP 和 Function Calling 有什么关系？' }, { role: 'assistant', content: answer, reasoningContent: '整理两者的职责与调用流程，形成对照。', reasoningDurationMs: 8000 }] },
      ...['React 状态管理选择', '帮我分析这个页面布局', 'Bun 与 Node.js 的差异', '整理 TypeScript 学习笔记', '解释 WebGPU 渲染管线', '一周学习计划'].map((title, i) => ({ id: `ui-refresh-${i}`, title, messages: [] })),
    ])
    await evaluate(client, `localStorage.setItem('chatbot-theme','dark')`)
    await client.send('Page.reload')
    await waitFor(client, `Boolean(document.querySelector('.message-row.assistant'))`)
    await settle(client)
    await installContextFixture(client)
    results.dark = await geometry(client)
    assert.equal(results.dark.sidebar.width, 248)
    assert.equal(results.dark.bodyFont, '14px')
    assert.equal(results.dark.overflow, false)
    assert.equal(results.dark.messages.x, results.dark.composer.x)
    assert.equal(results.dark.messages.width, results.dark.composer.width)
    assert.equal(results.dark.composer.width, 820)
    assert.equal(await evaluate(client, `getComputedStyle(document.querySelector('.markdown-message ol')).listStyleType`), 'decimal')
    results.tooltip = await hoverTooltip(client, '.new-chat-btn')
    await typeText(client, '能用一个实际例子说明吗？')
    await capture(client, 'desktop-dark')

    const beforeFocus = await evaluate(client, `getComputedStyle(document.querySelector('.composer-inner')).borderColor`)
    await click(client, 'textarea')
    const focus = await evaluate(client, `({border:getComputedStyle(document.querySelector('.composer-inner')).borderColor,outline:getComputedStyle(document.querySelector('textarea')).outlineStyle,shadow:getComputedStyle(document.querySelector('textarea')).boxShadow})`)
    assert.equal(focus.border, beforeFocus)
    assert.equal(focus.outline, 'none')
    assert.equal(focus.shadow, 'none')
    assert.equal(await evaluate(client, `getComputedStyle(document.querySelector('.composer-plus-btn')).borderWidth`), '0px')
    assert.equal(await evaluate(client, `Boolean(document.querySelector('.microphone-btn'))`), false)

    await click(client, '.model-menu-trigger')
    await waitFor(client, `Boolean(document.querySelector('.model-submenu'))`)
    await settle(client)
    const menu = await evaluate(client, `(() => {
      const el=document.querySelector('.model-submenu'), r=el.getBoundingClientRect();
      return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,count:document.querySelectorAll('[role="menu"]').length,selected:el.querySelectorAll('[aria-checked="true"]').length,heading:parseFloat(getComputedStyle(el.querySelector('.submenu-heading')).fontSize),option:parseFloat(getComputedStyle(el.querySelector('.option-item')).fontSize),color:getComputedStyle(el.querySelector('.option-item:not([data-disabled])')).color};
    })()`)
    assert.equal(menu.inside, true)
    assert.equal(menu.count, 1)
    assert.equal(menu.selected, 1)
    assert.ok(menu.heading < menu.option)
    await capture(client, 'model-dark')
    await escape(client)
    await click(client, '.effort-menu-trigger')
    await waitFor(client, `Boolean(document.querySelector('.effort-submenu'))`)
    assert.equal(await evaluate(client, `getComputedStyle(document.querySelector('.effort-submenu .option-item')).color`), menu.color)
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home' })
    for (let step = 0; step < 10; step += 1) {
      const focused = await evaluate(client, `({label:document.activeElement?.getAttribute('aria-label'),disabled:document.activeElement?.hasAttribute('data-disabled')})`)
      assert.equal(focused.disabled, false)
      if (focused.label === '思考强度 高') break
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' })
    }
    assert.equal(await evaluate(client, `document.activeElement?.getAttribute('aria-label')`), '思考强度 高')
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    await waitFor(client, `document.querySelector('.effort-menu-trigger').textContent.includes('高')`)
    await click(client, '.theme-toggle-btn')
    await settle(client)
    results.light = await geometry(client)
    assert.deepEqual(results.light, results.dark, 'Theme must not alter geometry or typography')
    await capture(client, 'desktop-light')
    await click(client, '.model-menu-trigger')
    await waitFor(client, `Boolean(document.querySelector('.model-submenu'))`)
    await capture(client, 'model-light')
    await escape(client)

    await click(client, '.context-toggle')
    await waitFor(client, `Boolean(document.querySelector('.panel-right [aria-label="本次请求"]'))`)
    await settle(client)
    results.context = await evaluate(client, `({width:document.querySelector('.panel-right').getBoundingClientRect().width,modal:Boolean(document.querySelector('[role="dialog"]')),overflow:document.documentElement.scrollWidth>innerWidth,collapsed:[...document.querySelectorAll('.context-disclosure')].every(el=>!el.open)})`)
    assert.deepEqual(results.context, { width: 320, modal: false, overflow: false, collapsed: true })
    await capture(client, 'context-light')
    await click(client, '.theme-toggle-btn')
    await capture(client, 'context-dark')
    await hoverTooltip(client, '.context-debug-modal .close-btn')
    await click(client, '.context-tab-list button:nth-of-type(2)')
    await waitFor(client, `!document.querySelector('[aria-label="本次请求"]')`)
    assert.equal(await evaluate(client, `[...document.querySelectorAll('.context-disclosure')].every(el=>!el.open)`), true)
    await escape(client)
    await waitFor(client, `!document.querySelector('.context-debug-modal')`)
    assert.equal(await evaluate(client, `document.activeElement === document.querySelector('.context-toggle')`), true)
    await click(client, '.context-toggle')
    await waitFor(client, `Boolean(document.querySelector('.context-debug-modal'))`)
    await typeText(client, '更新问题后不保留过期上下文')
    await waitFor(client, `!document.querySelector('.context-debug-modal')`)
    await click(client, '.theme-toggle-btn')

    if (process.env.CDP_SCREENSHOTS === '1') {
      await client.send('Emulation.setDeviceMetricsOverride', { width: 1487, height: 1058, deviceScaleFactor: 1, mobile: false })
      await typeText(client, '能用一个实际例子说明吗？')
      await click(client, '.theme-toggle-btn')
      await capture(client, 'reference-desktop-dark')
      await click(client, '.context-toggle')
      await waitFor(client, `Boolean(document.querySelector('.context-tab-list'))`)
      await capture(client, 'reference-context-dark')
      await click(client, '.context-debug-modal .close-btn')
      await click(client, '.theme-toggle-btn')
      await click(client, '.model-menu-trigger')
      await waitFor(client, `Boolean(document.querySelector('.model-submenu'))`)
      await capture(client, 'reference-model-light')
      await escape(client)
      await click(client, 'button[aria-label="更多操作"]')
      await waitFor(client, `Boolean(document.querySelector('.app-actions-menu'))`)
      await click(client, 'button[aria-label="参数"]')
      await waitFor(client, `Boolean(document.querySelector('.settings-modal'))`)
      results.dialogTooltip = await hoverTooltip(client, '.settings-modal .close-btn')
      await escape(client)
      await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    }

    await click(client, '.sidebar-toggle')
    assert.equal(await evaluate(client, `Boolean(document.querySelector('.sidebar'))`), false)
    await click(client, '.sidebar-toggle')
    await click(client, '.new-chat-btn')
    await waitFor(client, `Boolean(document.querySelector('.empty-state'))`)
    await settle(client)
    const empty = await evaluate(client, `(() => {const e=document.querySelector('.empty-state').getBoundingClientRect(), c=document.querySelector('.composer-inner').getBoundingClientRect();return {gap:c.top-e.bottom,center:c.top<innerHeight*.65,draft:document.querySelector('textarea').value}})()`)
    assert.ok(empty.gap >= 0 && empty.gap <= 40)
    assert.equal(empty.center, true)
    assert.equal(empty.draft, '')
    await capture(client, 'empty-light')

    for (const width of [1280, 1024, 821, 390, 320]) {
      await client.send('Emulation.setDeviceMetricsOverride', { width, height: width > 820 ? 900 : 844, deviceScaleFactor: 1, mobile: width <= 820 })
      await settle(client)
      const state = await geometry(client)
      assert.equal(state.overflow, false)
      assert.ok(state.composer.right <= width)
      if (width <= 820) {
        assert.equal(state.sidebar, null)
        assert.equal(state.header.height, 52)
        await click(client, '.sidebar-toggle')
        await waitFor(client, `Boolean(document.querySelector('.workspace-sheet .sidebar'))`)
        await capture(client, `sidebar-${width}`)
        const trap = await evaluate(client, `document.querySelector('.workspace-sheet').contains(document.activeElement)`)
        assert.equal(trap, true)
        await evaluate(client, `(() => {const item=[...document.querySelectorAll('.conversation-item')].find(el=>el.textContent.includes('MCP 与 Function Calling')); item.setAttribute('data-test-target','conversation'); return true})()`)
        await click(client, '[data-test-target="conversation"]')
        await waitFor(client, `!document.querySelector('.workspace-sheet')`)
        await waitFor(client, `Boolean(document.querySelector('.message-row.assistant'))`)
        assert.equal((await geometry(client)).overflow, false)
        const table = await evaluate(client, `(() => {
          const table=document.querySelector('.markdown-message table'), paragraph=document.querySelector('.markdown-message p'), before=paragraph.getBoundingClientRect().x;
          table.scrollLeft=table.scrollWidth;
          const last=table.querySelector('th:last-child').getBoundingClientRect(), bounds=table.getBoundingClientRect();
          const state={scrolls:table.scrollLeft>0,lastColumnVisible:last.right<=bounds.right+1,paragraphStable:paragraph.getBoundingClientRect().x===before};
          table.scrollLeft=0;
          return state;
        })()`)
        assert.deepEqual(table, { scrolls: true, lastColumnVisible: true, paragraphStable: true })
        await capture(client, `mobile-${width}`)
        await click(client, '.model-menu-trigger')
        await waitFor(client, `Boolean(document.querySelector('.mobile-model-sheet'))`)
        await settle(client)
        assert.equal(await evaluate(client, `(() => {const r=document.querySelector('.mobile-model-sheet').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`), true)
        await capture(client, `model-${width}`)
        await escape(client)
        await click(client, 'button[aria-label="更多操作"]')
        await waitFor(client, `Boolean(document.querySelector('.context-menu-item'))`)
        await click(client, '.context-menu-item')
        await waitFor(client, `Boolean(document.querySelector('.workspace-sheet .context-debug-modal'))`)
        assert.equal(await evaluate(client, `document.querySelector('.workspace-sheet').contains(document.activeElement)`), true)
        assert.equal((await geometry(client)).overflow, false)
        await capture(client, `context-${width}`)
        await escape(client)
        await waitFor(client, `!document.querySelector('.workspace-sheet')`)
        assert.equal(await evaluate(client, `document.activeElement === document.querySelector('button[aria-label="更多操作"]')`), true)
      } else {
        assert.equal(state.sidebar.width, 248)
        assert.equal(await evaluate(client, `!document.querySelector('.mobile-model-trigger') && document.querySelectorAll('.model-menu-trigger').length===1`), true)
      }
      results[width] = state
    }
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 500, deviceScaleFactor: 1, mobile: true })
    await typeText(client, Array.from({ length: 12 }, (_, i) => '多行草稿 ' + i).join('\n'))
    await settle(client)
    results.shortViewport = await evaluate(client, `(() => {const c=document.querySelector('.composer-inner').getBoundingClientRect(), h=document.querySelector('.chat-header').getBoundingClientRect(), t=document.querySelector('textarea');return {inside:c.bottom<=innerHeight&&c.top>=h.bottom,inputHeight:t.getBoundingClientRect().height,inputScrolls:t.scrollHeight>t.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
    assert.equal(results.shortViewport.inside, true)
    assert.ok(results.shortViewport.inputHeight <= 96)
    assert.equal(results.shortViewport.inputScrolls, true)
    assert.equal(results.shortViewport.overflow, false)
    await capture(client, 'mobile-short-viewport')
    await setPlan(client, [{ kind: 'success', chunks: ['新版 UI 发送与流式回复正常。'], interval: 20 }])
    await ask(client, '检查移动端发送')
    await waitFor(client, `document.body.innerText.includes('新版 UI 发送与流式回复正常。')`)
    await waitIdle(client)
    assert.equal(await evaluate(client, `document.querySelector('textarea').value`), '')
    assert.deepEqual(errors, [])
    results.consoleErrors = errors
    await mkdir(output, { recursive: true })
    await writeFile(new URL('results.json', output), JSON.stringify(results, null, 2))
    return results
  } catch (error) {
    await capture(client, 'failure', true)
    throw error
  }
}

runScenarioModule(import.meta.url, 'workspace-layout', runWorkspaceLayout)
