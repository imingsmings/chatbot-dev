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

export async function runLayoutScroll(client) {
  const groupResults = {}
  await resetPage(client)
      console.log('UI stage: retry and scroll')
      await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      chunks: ['重复停止第一段。', '重复停止第二段。'],
      interval: 350,
      done: false,
    }])
    await ask(client, '测试重复停止')
    await waitFor(client, `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`)
    await setMockFlags(client, { cancelDelayMs: 180 })
    const cancelCountBefore = await evaluate(
      client,
      `window.__mockSnapshot().requests.filter((request) => request.pathname.endsWith('/cancel')).length`,
    )
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((node) => node.textContent.trim() === '停止');
        button?.click();
        button?.click();
        button?.click();
      })()`,
    )
    await waitFor(
      client,
      `[...document.querySelectorAll('button')]
        .some((button) =>
          button.textContent.trim() === '停止中...' &&
          button.disabled &&
          button.classList.contains('stopping') &&
          button.getAttribute('aria-busy') === 'true'
        )`,
    )
    const cancelCountDuring = await evaluate(
      client,
      `window.__mockSnapshot().requests.filter((request) => request.pathname.endsWith('/cancel')).length`,
    )
    if (cancelCountDuring - cancelCountBefore !== 1) {
      throw new Error(`Repeated stop caused duplicate cancel requests: ${cancelCountDuring - cancelCountBefore}`)
    }
    await waitFor(client, `document.body.innerText.includes('已停止生成') && [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送')`)
    await setMockFlags(client, { cancelDelayMs: 0 })
    await screenshot(client, '01-repeat-stop')

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      chunks: ['这是可以复制的助手回复。'],
      interval: 40,
    }])
    await ask(client, '测试复制')
    await waitFor(client, `document.body.innerText.includes('这是可以复制的助手回复。') && document.body.innerText.includes('复制')`)
    await waitIdle(client)
    await ensureClipboard(client)
    await clickText(client, 'button', '复制')
    await waitFor(client, `document.body.innerText.includes('已复制')`)
    await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((node) => node.textContent.trim() === '已复制');
        button?.focus();
      })()`,
    )
    await screenshot(client, '02-copy-shows-copied')

    await resetPage(client)
    await setPlan(client, [
      { kind: 'streamError', message: '模拟失败，请重试' },
      { kind: 'success', chunks: ['重试后在原位置生成成功。'], interval: 40 },
    ])
    await ask(client, '测试失败重试')
    await waitFor(client, `document.body.innerText.includes('模拟失败，请重试') && document.body.innerText.includes('重试')`)
    await waitIdle(client)
    await screenshot(client, '03-failed-message-retry-button')
    await clickText(client, 'button', '重试')
    await waitFor(client, `document.body.innerText.includes('重试后在原位置生成成功。') && !document.body.innerText.includes('模拟失败，请重试')`)
    await waitIdle(client)
    const retryState = await evaluate(
      client,
      `(() => ({
        userRows: [...document.querySelectorAll('.message-row.user')].length,
        assistantRows: [...document.querySelectorAll('.message-row.assistant')].length,
        askCount: window.__askCount,
        text: document.querySelector('.message-list')?.innerText,
      }))()`,
    )
    await screenshot(client, '03-retry-regenerated-same-slot')

    await resetPage(client)
    await setPlan(client, [
      { kind: 'success', chunks: makeLongChunks('历史回复 A', 16), interval: 1 },
      { kind: 'success', chunks: makeLongChunks('历史回复 B', 16), interval: 1 },
      { kind: 'success', chunks: makeLongChunks('历史回复 C', 16), interval: 1 },
      { kind: 'success', chunks: makeLongChunks('新流式回复', 40), interval: 120, done: false },
    ])
    await ask(client, '历史问题 A')
    await waitFor(client, `document.body.innerText.includes('历史回复 A 16.')`)
    await waitIdle(client)
    await ask(client, '历史问题 B')
    await waitFor(client, `document.body.innerText.includes('历史回复 B 16.')`)
    await waitIdle(client)
    await ask(client, '历史问题 C')
    await waitFor(client, `document.body.innerText.includes('历史回复 C 16.')`)
    await waitIdle(client)
    await evaluate(client, `document.querySelector('.chat-scroll').scrollTop = document.querySelector('.chat-scroll').scrollHeight`)
    await delay(100)
    const bottomGapAtBottom = await evaluate(client, `(() => {
      const el = document.querySelector('.chat-scroll');
      return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    })()`)
    if (bottomGapAtBottom > 96) {
      throw new Error(`Scroll follow near bottom failed: bottomGapAtBottom=${bottomGapAtBottom}`)
    }
    await ask(client, '接近底部时跟随新内容')
    await delay(900)
    const bottomGapFollow = await evaluate(client, `(() => {
      const el = document.querySelector('.chat-scroll');
      return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    })()`)
    if (bottomGapFollow > 96) {
      throw new Error(`Scroll follow during streaming failed: bottomGapFollow=${bottomGapFollow}`)
    }
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    await waitIdle(client)

    await setPlan(client, [{
      kind: 'success',
      chunks: makeCodeBlockChunks(64),
      interval: 15,
      done: false,
    }])
    await evaluate(client, `document.querySelector('.chat-scroll').scrollTop = document.querySelector('.chat-scroll').scrollHeight`)
    await delay(100)
    const codeBlockScrollBefore = await evaluate(client, `Math.round(document.querySelector('.chat-scroll').scrollTop)`)
    await ask(client, '代码块结尾时保持自动滚动')
    await waitFor(
      client,
      `document.querySelector('.code-block code')?.textContent.includes('streamedRow64')`,
    )
    await delay(250)
    const codeBlockFollowState = await evaluate(
      client,
      `(() => {
        const scroll = document.querySelector('.chat-scroll');
        const code = document.querySelector('.code-block');
        return {
          bottomGap: Math.round(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight),
          codeBlockHeight: Math.round(code.getBoundingClientRect().height),
          scrollTop: Math.round(scroll.scrollTop),
        };
      })()`,
    )
    if (
      codeBlockFollowState.bottomGap > 96 ||
      codeBlockFollowState.codeBlockHeight < 600 ||
      codeBlockFollowState.scrollTop <= codeBlockScrollBefore
    ) {
      throw new Error(
        `Streaming code-block follow failed: before=${codeBlockScrollBefore}, state=${JSON.stringify(codeBlockFollowState)}`,
      )
    }
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    await waitIdle(client)

    await setPlan(client, [
      { kind: 'success', chunks: makeLongChunks('新流式回复', 40), interval: 120, done: false },
    ])
    await evaluate(client, `document.querySelector('.chat-scroll').scrollTop = 0`)
    const scrollBefore = await evaluate(client, `Math.round(document.querySelector('.chat-scroll').scrollTop)`)
    const bottomGapBefore = await evaluate(client, `(() => {
      const el = document.querySelector('.chat-scroll');
      return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    })()`)
    await ask(client, '新内容生成时我正在看历史')
    await delay(1200)
    const scrollDuring = await evaluate(client, `Math.round(document.querySelector('.chat-scroll').scrollTop)`)
    const bottomGap = await evaluate(client, `(() => {
      const el = document.querySelector('.chat-scroll');
      return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    })()`)
    if (bottomGapBefore <= 96 || bottomGap <= 96) {
      throw new Error(
        `Scroll follow guard failed: bottomGapBefore=${bottomGapBefore}, bottomGap=${bottomGap}, scrollBefore=${scrollBefore}, scrollDuring=${scrollDuring}`,
      )
    }
    await screenshot(client, '04-scroll-does-not-force-bottom')
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)

      Object.assign(groupResults, {
        retryState,
        scrollBefore,
        bottomGapAtBottom,
        bottomGapFollow,
        codeBlockFollowState,
        bottomGapBefore,
        scrollDuring,
        bottomGap,
      })
      console.log('UI stage: mobile layout and frontend errors')
      await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      chunks: ['移动端长消息 '.repeat(80)],
      interval: 20,
    }])
    await ask(client, '移动端布局')
    await waitFor(client, `document.body.innerText.includes('移动端长消息')`)
    await waitIdle(client)
    await evaluate(
      client,
      `(() => {
        const chatScroll = document.querySelector('.chat-scroll');
        chatScroll?.scrollTo({ top: chatScroll.scrollHeight });
      })()`,
    )
    await waitFor(
      client,
      `(() => {
        const chatScroll = document.querySelector('.chat-scroll');
        return chatScroll && Math.abs(chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight) <= 24;
      })()`,
    )
    const mobileState = await evaluate(
      client,
      `(() => {
        const composer = document.querySelector('.composer');
        const chatScroll = document.querySelector('.chat-scroll');
        const composerRect = composer.getBoundingClientRect();
        const chatScrollRect = chatScroll.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
          composerOverlapsScroll: composerRect.top < chatScrollRect.bottom - 1,
          scrollBottomGap: Math.round(Math.abs(chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight)),
          shellWidth: document.querySelector('.app-shell').getBoundingClientRect().width,
        };
      })()`,
    )
    if (
      mobileState.pageOverflowX ||
      mobileState.composerOverlapsScroll ||
      mobileState.scrollBottomGap > 24 ||
      mobileState.shellWidth > 390
    ) {
      throw new Error(`Mobile layout failed: ${JSON.stringify(mobileState)}`)
    }
    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      reasoningChunks: ['移动端 reasoning 长文本 '.repeat(80)],
      chunks: ['移动端 reasoning 正文。'],
      interval: 20,
    }])
    await ask(client, '移动端 reasoning 布局')
    await waitFor(client, `document.body.innerText.includes('移动端 reasoning 正文。')`)
    await waitIdle(client)
    const mobileReasoningState = await evaluate(
      client,
      `(() => {
        const panel = document.querySelector('.reasoning-panel');
        const body = document.querySelector('.reasoning-content-body');
        return {
          hasPanel: Boolean(panel),
          pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
          panelWidth: Math.ceil(panel?.getBoundingClientRect().width || 0),
          bodyWidth: Math.ceil(body?.getBoundingClientRect().width || 0),
          viewportWidth: window.innerWidth,
        };
      })()`,
    )
    if (
      !mobileReasoningState.hasPanel ||
      mobileReasoningState.pageOverflowX ||
      mobileReasoningState.panelWidth > mobileReasoningState.viewportWidth ||
      mobileReasoningState.bodyWidth > mobileReasoningState.viewportWidth
    ) {
      throw new Error(`Mobile reasoning layout failed: ${JSON.stringify(mobileReasoningState)}`)
    }
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
      Object.assign(groupResults, { mobileState, mobileReasoningState })
  return groupResults
}

runScenarioModule(import.meta.url, 'layout-scroll', runLayoutScroll)
