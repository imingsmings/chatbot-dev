import {
  ask,
  clickConversationAt,
  confirmDialog,
  evaluate,
  runScenarioModule,
  seedConversations,
  setMockFlags,
  setPlan,
  typeText,
  waitFor,
  waitIdle,
} from './harness.mjs'

async function clickSelector(client, selector) {
  const point = await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return null;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`)
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

async function hoverSelector(client, selector) {
  const point = await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return null;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`)
  if (!point) throw new Error(`Cannot hover selector: ${selector}`)
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  })
}

async function selectEffort(client, effort) {
  await waitFor(client, `document.querySelector('.model-menu-trigger')?.disabled === false`)
  await clickSelector(client, '.model-menu-trigger')
  await waitFor(client, `Boolean(document.querySelector('.model-options-menu'))`, 10_000)
  await hoverSelector(client, 'button[aria-label="Select Effort"]')
  await waitFor(client, `Boolean(document.querySelector('.effort-submenu'))`, 10_000)
  await clickSelector(client, `button[aria-label="Select Effort ${effort}"]`)
}

function triggerIncludes(model, effort) {
  return `(() => {
    const trigger = document.querySelector('.model-menu-trigger');
    const label = trigger?.getAttribute('aria-label') || '';
    return label.includes(${JSON.stringify(model)}) && label.endsWith(${JSON.stringify(`, ${effort}`)});
  })()`
}

export async function runModelOptionsPersistence(client) {
  const flash = {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    reasoningEnabled: true,
    reasoningEffort: 'low',
    temperature: 0.7,
    maxTokens: 4096,
  }
  const pro = {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    reasoningEnabled: true,
    reasoningEffort: 'high',
    temperature: 0.2,
    maxTokens: 8192,
  }

  console.log('UI stage: conversation model option persistence and races')
  await seedConversations(client, [
    {
      id: 'ui-model-a',
      title: '模型配置 A',
      createdAt: '2026-08-13T01:00:00.000Z',
      updatedAt: '2026-08-13T02:00:00.000Z',
      messages: [],
      modelOptions: pro,
    },
    {
      id: 'ui-model-b',
      title: '模型配置 B',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T01:00:00.000Z',
      messages: [],
      modelOptions: flash,
    },
  ])
  await client.send('Page.reload')
  await waitFor(client, triggerIncludes('DeepSeek V4 Pro', 'High'))

  await clickConversationAt(client, 1)
  await waitFor(client, triggerIncludes('DeepSeek V4 Flash', 'Low'))
  await clickConversationAt(client, 0)
  await waitFor(client, triggerIncludes('DeepSeek V4 Pro', 'High'))

  await client.send('Page.reload')
  await waitFor(client, triggerIncludes('DeepSeek V4 Pro', 'High'))

  await typeText(client, '保存期间发送应被禁用')
  await setMockFlags(client, { modelOptionsDelayMs: 300 })
  await selectEffort(client, 'Low')
  await waitFor(client, `document.querySelector('.model-menu-trigger')?.disabled === true`)
  const savingState = await evaluate(client, `(() => ({
    textareaDisabled: document.querySelector('textarea')?.disabled,
    modelDisabled: document.querySelector('.model-menu-trigger')?.disabled,
    sendDisabled: document.querySelector('button[aria-label="发送消息"]')?.disabled,
    appActionsDisabled: document.querySelector('button[aria-label="更多操作"]')?.disabled,
    composerToolsDisabled: document.querySelector('button[aria-label="添加和工具"]')?.disabled,
    patchCount: window.__mockSnapshot().requests.filter(
      (request) => request.pathname.endsWith('/model-options') && request.method === 'PATCH'
    ).length,
  }))()`)
  if (
    savingState.textareaDisabled !== true ||
    savingState.modelDisabled !== true ||
    savingState.sendDisabled !== true ||
    savingState.appActionsDisabled !== true ||
    savingState.composerToolsDisabled !== true ||
    savingState.patchCount !== 1
  ) {
    throw new Error(`Model option saving gate failed: ${JSON.stringify(savingState)}`)
  }
  await waitFor(
    client,
    `${triggerIncludes('DeepSeek V4 Pro', 'Low')} && document.querySelector('.model-menu-trigger')?.disabled === false`,
  )
  await setMockFlags(client, { modelOptionsDelayMs: 0 })

  const storedAfterSave = await evaluate(
    client,
    `window.__mockSnapshot().conversations.find((item) => item.id === 'ui-model-a')?.modelOptions`,
  )
  if (storedAfterSave?.reasoningEffort !== 'low' || storedAfterSave?.model !== 'deepseek-v4-pro') {
    throw new Error(`Persisted model options mismatch: ${JSON.stringify(storedAfterSave)}`)
  }

  await client.send('Page.reload')
  await waitFor(client, triggerIncludes('DeepSeek V4 Pro', 'Low'))

  await setMockFlags(client, { failNextModelOptions: true })
  await selectEffort(client, 'High')
  await waitFor(client, `document.body.innerText.includes('model options failed')`)
  const rollbackState = await evaluate(client, `(() => ({
    label: document.querySelector('.model-menu-trigger')?.getAttribute('aria-label'),
    storedEffort: window.__mockSnapshot().conversations
      .find((item) => item.id === 'ui-model-a')?.modelOptions?.reasoningEffort,
  }))()`)
  if (!rollbackState.label?.endsWith(', Low') || rollbackState.storedEffort !== 'low') {
    throw new Error(`Model option rollback failed: ${JSON.stringify(rollbackState)}`)
  }
  await confirmDialog(client, '知道了')
  await waitFor(client, `document.querySelector('.model-menu-trigger')?.disabled === false`)

  await selectEffort(client, 'High')
  await waitFor(
    client,
    `${triggerIncludes('DeepSeek V4 Pro', 'High')} && document.querySelector('.model-menu-trigger')?.disabled === false`,
  )

  await setPlan(client, [{ kind: 'success', chunks: ['配置请求已匹配。'], interval: 20 }])
  await ask(client, '验证请求模型配置')
  await waitFor(client, `document.body.innerText.includes('配置请求已匹配。')`)
  await waitIdle(client)
  const askOptions = await evaluate(
    client,
    `window.__mockSnapshot().requests.filter((request) => request.pathname.endsWith('/ask')).at(-1)?.body?.options`,
  )
  if (askOptions?.model !== 'deepseek-v4-pro' || askOptions?.reasoningEffort !== 'high') {
    throw new Error(`Ask options did not match persisted selection: ${JSON.stringify(askOptions)}`)
  }

  await seedConversations(client, [{
    id: 'ui-disabled-model',
    title: '禁用模型旧会话',
    createdAt: '2026-08-13T03:00:00.000Z',
    updatedAt: '2026-08-13T03:00:00.000Z',
    messages: [],
    modelOptions: {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      reasoningEnabled: true,
      reasoningEffort: 'high',
    },
  }])
  await client.send('Page.reload')
  await waitFor(client, triggerIncludes('DeepSeek V4 Flash', 'Medium'))
  const fallbackState = await evaluate(client, `(() => ({
    askCount: window.__mockSnapshot().askCount,
    patchCount: window.__mockSnapshot().requests.filter(
      (request) => request.pathname.endsWith('/model-options')
    ).length,
  }))()`)
  if (fallbackState.askCount !== 0 || fallbackState.patchCount !== 0) {
    throw new Error(`Disabled legacy fallback triggered a request: ${JSON.stringify(fallbackState)}`)
  }

  return {
    savingState,
    rollbackState,
    askOptions,
    fallbackState,
  }
}

runScenarioModule(
  import.meta.url,
  'model-options-persistence',
  runModelOptionsPersistence,
)
