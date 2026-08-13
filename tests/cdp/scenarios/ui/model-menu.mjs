import {
  ask,
  cancelDialog,
  clickConversationActionAt,
  clickConversationAt,
  clickDialogButton,
  clickFirstSuggestion,
  clickText,
  confirmDialog,
  delay,
  ensureClipboard,
  evaluate,
  invokeConversationActionAt,
  makeCodeBlockChunks,
  makeLongChunks,
  resetPage,
  runScenarioModule,
  screenshot,
  seedConversations,
  setMockFlags,
  setPlan,
  submitPromptDialog,
  typeText,
  waitFor,
  waitForDialog,
  waitIdle,
} from './harness.mjs'

export async function runModelMenu(client) {
  const groupResults = {}
  await resetPage(client)
      console.log('UI stage: reasoning panel and stream protocol')
    await setPlan(client, [{
      kind: 'success',
      reasoningChunks: ['先分析问题。', '再给出结论。'],
      chunks: ['最终回答。'],
      reasoningInterval: 20,
      interval: 20,
      reasoningDurationMs: 88,
    }])
    await ask(client, '测试 reasoning 面板')
    await waitFor(client, `document.body.innerText.includes('最终回答。')`)
    await waitIdle(client)
    const reasoningState = await evaluate(
      client,
      `(() => {
        const panel = document.querySelector('.reasoning-panel');
        const summary = document.querySelector('.reasoning-summary');
        const body = document.querySelector('.reasoning-content-body');
        const assistant = [...document.querySelectorAll('.message-row.assistant')].at(-1);
        return {
          hasPanel: Boolean(panel),
          open: panel?.hasAttribute('open') ?? null,
          summary: summary?.textContent.trim(),
          reasoningText: body?.textContent.trim(),
          answerText: assistant?.innerText || '',
        };
      })()`,
    )
    if (
      !reasoningState.hasPanel ||
      reasoningState.open !== false ||
      !(reasoningState.summary === 'Thoughts' || reasoningState.summary.startsWith('已深度思考')) ||
      !reasoningState.reasoningText.includes('先分析问题。再给出结论。') ||
      !reasoningState.answerText.includes('最终回答。')
    ) {
      throw new Error(`Reasoning panel assertions failed: ${JSON.stringify(reasoningState)}`)
    }

    const densityAlignmentState = await evaluate(
      client,
      `(() => {
        const messageList = document.querySelector('.message-list');
        const composer = document.querySelector('.composer-inner');
        const assistantText = [...document.querySelectorAll('.message-row.assistant .message-text')].at(-1);
        const reasoningSummary = document.querySelector('.reasoning-summary');
        const textarea = document.querySelector('textarea');
        const modelTrigger = document.querySelector('.model-menu-trigger');
        const microphoneButton = document.querySelector('.microphone-btn');
        const sendButton = document.querySelector('.send-btn');
        const reasoningPanel = document.querySelector('.reasoning-panel');
        const messageRect = messageList.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const triggerRect = modelTrigger.getBoundingClientRect();
        const microphoneRect = microphoneButton.getBoundingClientRect();
        const sendRect = sendButton.getBoundingClientRect();
        const reasoningRect = reasoningPanel.getBoundingClientRect();
        const answerRect = assistantText.getBoundingClientRect();
        const triggerStyle = getComputedStyle(modelTrigger);
        const fontSize = (element) => Number.parseFloat(getComputedStyle(element).fontSize);
        return {
          xDelta: Math.abs(messageRect.x - composerRect.x),
          widthDelta: Math.abs(messageRect.width - composerRect.width),
          assistantFontSize: fontSize(assistantText),
          reasoningFontSize: fontSize(reasoningSummary),
          inputFontSize: fontSize(textarea),
          triggerFontSize: fontSize(modelTrigger),
          triggerHeight: triggerRect.height,
          triggerBorderWidth: Number.parseFloat(triggerStyle.borderLeftWidth),
          microphoneSize: { width: microphoneRect.width, height: microphoneRect.height },
          sendSize: { width: sendRect.width, height: sendRect.height },
          placeholder: textarea.getAttribute('placeholder'),
          reasoningAnswerGap: answerRect.top - reasoningRect.bottom,
          pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
        };
      })()`,
    )
    if (
      densityAlignmentState.xDelta > 1 ||
      densityAlignmentState.widthDelta > 1 ||
      ![densityAlignmentState.assistantFontSize, densityAlignmentState.reasoningFontSize,
        densityAlignmentState.inputFontSize, densityAlignmentState.triggerFontSize]
        .every((size) => size >= 13 && size <= 15) ||
      densityAlignmentState.triggerHeight > 32.5 ||
      densityAlignmentState.triggerBorderWidth !== 0 ||
      densityAlignmentState.placeholder !== 'Ask AI' ||
      Math.abs(densityAlignmentState.sendSize.width - densityAlignmentState.microphoneSize.width) > 0.5 ||
      Math.abs(densityAlignmentState.sendSize.height - densityAlignmentState.microphoneSize.height) > 0.5 ||
      densityAlignmentState.sendSize.width < 33 ||
      densityAlignmentState.sendSize.width > 35 ||
      densityAlignmentState.reasoningAnswerGap < 8 ||
      densityAlignmentState.reasoningAnswerGap > 16 ||
      densityAlignmentState.pageOverflowX
    ) {
      throw new Error(`Chat density and alignment failed: ${JSON.stringify(densityAlignmentState)}`)
    }

    await evaluate(client, `document.querySelector('.model-menu-trigger')?.click()`)
    await waitFor(client, `Boolean(document.querySelector('.model-options-menu'))`)
    await evaluate(client, `document.querySelector('button[aria-label="Select Model"]')?.click()`)
    await waitFor(client, `Boolean(document.querySelector('.model-submenu'))`)
    const modelMenuState = await evaluate(
      client,
      `(() => {
        const menu = document.querySelector('.model-options-menu');
        const submenu = document.querySelector('.model-submenu');
        const items = [...submenu.querySelectorAll('.option-item')];
        const menuRect = menu.getBoundingClientRect();
        const submenuRect = submenu.getBoundingClientRect();
        return {
          menuWidth: menuRect.width,
          submenuWidth: submenuRect.width,
          edgeGap: Math.min(
            Math.abs(submenuRect.left - menuRect.right),
            Math.abs(menuRect.left - submenuRect.right),
          ),
          labels: items.map((item) => item.textContent.trim()),
          selectedCount: items.filter((item) => item.classList.contains('selected')).length,
          maxItemHeight: Math.max(...items.map((item) => item.getBoundingClientRect().height)),
          enabledColor: getComputedStyle(items.find((item) => !item.matches(':disabled, [data-disabled], [aria-disabled="true"]'))).color,
        };
      })()`,
    )
    if (
      modelMenuState.menuWidth > 286 ||
      modelMenuState.submenuWidth > 242 ||
      modelMenuState.edgeGap > 1 ||
      JSON.stringify(modelMenuState.labels) !== JSON.stringify([
        'DeepSeek V4 Flash',
        'DeepSeek V4 Pro',
        'GPT-5.6 Luna',
        'GPT-5.6 Sol',
      ]) ||
      modelMenuState.selectedCount !== 1 ||
      modelMenuState.maxItemHeight > 36.5
    ) {
      throw new Error(`Model submenu density failed: ${JSON.stringify(modelMenuState)}`)
    }
    await evaluate(client, `document.querySelector('button[aria-label="Select DeepSeek V4 Pro"]')?.click()`)
    await waitFor(client, `document.querySelector('.model-menu-trigger')?.getAttribute('aria-label')?.includes('DeepSeek V4 Pro')`)

    await evaluate(client, `document.querySelector('.model-menu-trigger')?.click()`)
    await waitFor(client, `Boolean(document.querySelector('.model-options-menu'))`)
    await evaluate(client, `document.querySelector('button[aria-label="Select Effort"]')?.click()`)
    await waitFor(client, `Boolean(document.querySelector('.effort-submenu'))`)
    const effortMenuState = await evaluate(
      client,
      `(() => {
        const items = [...document.querySelectorAll('.effort-submenu .option-item')];
        return {
          labels: items.map((item) => item.textContent.trim()),
          selectedCount: document.querySelectorAll('.effort-submenu .option-item.selected').length,
          enabledColor: getComputedStyle(items.find((item) => !item.matches(':disabled, [data-disabled], [aria-disabled="true"]'))).color,
        };
      })()`,
    )
    if (
      JSON.stringify(effortMenuState.labels) !== JSON.stringify(['Off', 'Low', 'Medium', 'High', 'Max']) ||
      effortMenuState.selectedCount !== 1 ||
      effortMenuState.enabledColor !== modelMenuState.enabledColor
    ) {
      throw new Error(`Effort submenu structure failed: ${JSON.stringify(effortMenuState)}`)
    }
    await evaluate(client, `document.querySelector('button[aria-label="Select Effort High"]')?.click()`)
    await waitFor(client, `document.querySelector('.model-menu-trigger')?.getAttribute('aria-label')?.endsWith(', High')`)

    await ensureClipboard(client)
    await clickText(client, 'button', '复制')
    await waitFor(client, `document.body.innerText.includes('已复制')`)
    const reasoningCopyText = await evaluate(client, `navigator.clipboard.readText()`)
    if (reasoningCopyText.includes('先分析问题') || reasoningCopyText !== '最终回答。') {
      throw new Error(`Reasoning copy leaked non-answer text: ${JSON.stringify(reasoningCopyText)}`)
    }
    await evaluate(client, `document.querySelector('.reasoning-summary')?.click()`)
    const reasoningExpanded = await evaluate(client, `document.querySelector('.reasoning-panel')?.hasAttribute('open')`)
    await evaluate(client, `document.querySelector('.reasoning-summary')?.click()`)
    const reasoningCollapsed = await evaluate(client, `document.querySelector('.reasoning-panel')?.hasAttribute('open')`)
    if (reasoningExpanded !== true || reasoningCollapsed !== false) {
      throw new Error(`Reasoning expand/collapse failed: ${JSON.stringify({ reasoningExpanded, reasoningCollapsed })}`)
    }
    await typeText(client, '切换前 reasoning 草稿')
    await clickText(client, 'button', '新建')
    await waitFor(client, `document.querySelector('.empty-state') && document.querySelector('textarea')?.value === ''`)
    await clickConversationAt(client, 1)
    const reasoningAfterSwitch = await waitFor(
      client,
      `(() => {
        const panel = document.querySelector('.reasoning-panel');
        return panel &&
          document.querySelector('.reasoning-content-body')?.textContent.includes('先分析问题。再给出结论。') &&
          document.body.innerText.includes('最终回答。');
      })()`,
    )
    if (!reasoningAfterSwitch) {
      throw new Error('Reasoning panel was not restored after conversation switch')
    }

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      reasoningChunks: ['## reasoning 不应作为 Markdown 渲染'],
      chunks: ['**Markdown 正文加粗**\n\n```ts\nconst ok = true\n```'],
      interval: 20,
    }])
    await ask(client, 'reasoning + markdown')
    await waitFor(
      client,
      `document.querySelector('.reasoning-content-body')?.textContent.includes('## reasoning 不应作为 Markdown 渲染') &&
        document.querySelector('.message-row.assistant strong')?.textContent.includes('Markdown 正文加粗') &&
        document.querySelector('.message-row.assistant pre code')?.textContent.includes('const ok')`,
    )
    await waitIdle(client)
    const reasoningMarkdownState = await evaluate(
      client,
      `(() => ({
        reasoningRenderedAsHeading: Boolean(document.querySelector('.reasoning-content-body h2')),
        hasStrong: Boolean(document.querySelector('.message-row.assistant strong')),
        hasCode: Boolean(document.querySelector('.message-row.assistant pre code')),
      }))()`,
    )
    if (
      reasoningMarkdownState.reasoningRenderedAsHeading ||
      !reasoningMarkdownState.hasStrong ||
      !reasoningMarkdownState.hasCode
    ) {
      throw new Error(`Reasoning + Markdown assertions failed: ${JSON.stringify(reasoningMarkdownState)}`)
    }

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      reasoningChunks: ['这段 reasoning 会被停止。'],
      chunks: ['不应该完整输出。'],
      reasoningInterval: 300,
      interval: 300,
      done: false,
    }])
    await ask(client, 'reasoning 阶段停止')
    await waitFor(client, `document.body.innerText.includes('这段 reasoning 会被停止。')`)
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    await waitIdle(client)
    const reasoningAbortCount = await waitFor(client, `window.__abortCount > 0 && window.__abortCount`)

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      reasoningChunks: ['只有 reasoning，没有正文。'],
      chunks: [],
      interval: 20,
    }])
    await ask(client, 'reasoning only error')
    await waitFor(client, `document.body.innerText.includes('模型未返回内容')`)
    await waitIdle(client)

    await resetPage(client)
    await setPlan(client, [
      { kind: 'success', chunks: ['缺少协议 header。'], omitProtocolHeader: true, interval: 20 },
      { kind: 'success', chunks: ['协议错误后恢复成功。'], interval: 20 },
      { kind: 'invalidReasoningEvent' },
      { kind: 'invalidDoneEvent' },
    ])
    await ask(client, '缺少协议 header')
    await waitFor(client, `document.body.innerText.includes('不支持的流式协议版本')`)
    await waitIdle(client)
    await ask(client, '协议错误后恢复')
    await waitFor(client, `document.body.innerText.includes('协议错误后恢复成功。')`)
    await waitIdle(client)
    await ask(client, '非法 reasoning event')
    await waitFor(client, `document.body.innerText.includes('服务端返回了无效的流式内容')`)
    await waitIdle(client)
    await ask(client, '非法 done event')
    await waitFor(client, `document.body.innerText.includes('服务端返回了无效的完成事件')`)
      await waitIdle(client)
      Object.assign(groupResults, {
        reasoningState,
        reasoningAbortCount,
        reasoningExpanded,
        reasoningCollapsed,
        reasoningMarkdownState,
      })
  return groupResults
}

runScenarioModule(import.meta.url, 'model-menu', runModelMenu)
