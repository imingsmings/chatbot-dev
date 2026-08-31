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

export async function runStreamRecovery(client) {
  const groupResults = {}
  await resetPage(client)
      console.log('UI stage: stop/copy/recovery')
    await setPlan(client, [{
      kind: 'success',
      chunks: ['正在生成第一段。', '正在生成第二段。', '这段会保持生成状态。'],
      interval: 350,
      done: false,
    }])
    await ask(client, '测试停止按钮')
    await waitFor(client, `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`)
    await waitFor(client, `document.body.innerText.includes('正在生成第一段。')`)
    const streamingActionState = await evaluate(
      client,
      `(() => ({
        hasCopy: [...document.querySelectorAll('.message-row.assistant .message-action-btn')]
          .some((button) => button.textContent.trim() === '复制'),
        hasRetry: [...document.querySelectorAll('.message-row.assistant .message-action-btn')]
          .some((button) => button.textContent.trim() === '重试'),
        textareaDisabled: document.querySelector('textarea')?.disabled === true,
      }))()`,
    )
    if (streamingActionState.hasCopy || streamingActionState.hasRetry || !streamingActionState.textareaDisabled) {
      throw new Error(`Streaming action visibility failed: ${JSON.stringify(streamingActionState)}`)
    }
    await screenshot(client, '01-generating-stop-button')
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成') && [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送')`)
    await screenshot(client, '01-stopped-after-click')
    await ensureClipboard(client)
    await clickText(client, 'button', '复制')
    await waitFor(client, `document.body.innerText.includes('已复制')`)
    const stoppedActionState = await evaluate(
      client,
      `(() => ({
        hasCopied: document.body.innerText.includes('已复制'),
        hasRetry: [...document.querySelectorAll('.message-row.assistant .message-action-btn')]
          .some((button) => button.textContent.trim() === '重试'),
      }))()`,
    )
    if (!stoppedActionState.hasCopied || stoppedActionState.hasRetry) {
      throw new Error(`Stopped action visibility failed: ${JSON.stringify(stoppedActionState)}`)
    }
    await screenshot(client, '01-stopped-copy')

    await setPlan(client, [{
      kind: 'success',
      chunks: ['停止后新的请求成功。'],
      interval: 40,
    }])
    await ask(client, '停止后继续发送')
    await waitFor(client, `document.body.innerText.includes('停止后新的请求成功。')`)
    await waitIdle(client)
      await screenshot(client, '01-continue-after-stop')
      Object.assign(groupResults, { streamingActionState, stoppedActionState })
      console.log('UI stage: suggestions and theme')
      await resetPage(client)
    await clickFirstSuggestion(client)
    const suggestionState = await evaluate(
      client,
      `(() => ({
        value: document.querySelector('textarea').value,
        askCount: window.__askCount,
      }))()`,
    )
    if (!suggestionState.value.trim() || suggestionState.askCount !== 0) {
      throw new Error('Suggestion behavior assertions failed')
    }
    await setPlan(client, [{ kind: 'success', chunks: ['生成中 suggestion 不并发。'], interval: 300, done: false }])
    await ask(client, '生成中 suggestion')
    await waitFor(client, `document.body.innerText.includes('生成中 suggestion 不并发。')`)
    const suggestionDuringGeneration = await evaluate(
      client,
      `(() => ({
        askCount: window.__askCount,
        suggestionCount: document.querySelectorAll('.suggestion-card').length,
      }))()`,
    )
    if (suggestionDuringGeneration.askCount !== 1 || suggestionDuringGeneration.suggestionCount !== 0) {
      throw new Error('Suggestion caused concurrent request while generating')
    }
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)

    await resetPage(client)
    const initialTheme = await evaluate(client, `document.querySelector('.app-shell')?.dataset.theme`)
    await clickText(client, 'button', initialTheme === 'dark' ? '浅色' : '深色')
    const toggledTheme = await evaluate(client, `document.querySelector('.app-shell')?.dataset.theme`)
    await client.send('Page.reload')
    await waitFor(client, `document.querySelector('.app-shell')?.dataset.theme === ${JSON.stringify(toggledTheme)}`)
    await waitFor(client, `Boolean(document.querySelector('textarea') && document.querySelector('form'))`)
    const themePersistenceState = await evaluate(
      client,
      `(() => ({
        theme: document.querySelector('.app-shell')?.dataset.theme,
        storedTheme: localStorage.getItem('chatbot-theme'),
        textareaBackground: getComputedStyle(document.querySelector('textarea')).backgroundColor,
      }))()`,
    )
    if (
      themePersistenceState.theme !== toggledTheme ||
      themePersistenceState.storedTheme !== toggledTheme ||
      themePersistenceState.textareaBackground !== 'rgba(0, 0, 0, 0)'
    ) {
      throw new Error(`Theme persistence failed: ${JSON.stringify(themePersistenceState)}`)
    }
    await setPlan(client, [{ kind: 'success', chunks: ['主题切换生成中保持。'], interval: 300, done: false }])
    await ask(client, '主题生成中')
    await waitFor(client, `document.body.innerText.includes('主题切换生成中保持。')`)
    await clickText(client, 'button', toggledTheme === 'dark' ? '浅色' : '深色')
    const themeStreamingState = await evaluate(
      client,
      `(() => ({
        stillGenerating: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止'),
        theme: document.querySelector('.app-shell')?.dataset.theme,
        textareaBackground: getComputedStyle(document.querySelector('textarea')).backgroundColor,
      }))()`,
    )
    if (
      !themeStreamingState.stillGenerating ||
      themeStreamingState.theme === toggledTheme ||
      themeStreamingState.textareaBackground !== 'rgba(0, 0, 0, 0)'
    ) {
      throw new Error('Theme toggle during streaming failed')
    }
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)

    await resetPage(client)
    await setPlan(client, [{ kind: 'success', chunks: ['刷新恢复当前会话内容。'], interval: 20 }])
    await ask(client, '刷新恢复当前会话')
    await waitFor(client, `document.body.innerText.includes('刷新恢复当前会话内容。')`)
    await waitIdle(client)
    await typeText(client, '刷新前草稿会清空')
    await client.send('Page.reload')
    await waitFor(
      client,
      `document.body.innerText.includes('刷新恢复当前会话内容。') &&
        document.querySelector('textarea')?.value === '' &&
        document.querySelectorAll('.conversation-item-shell.active').length === 1`,
    )
    const reloadRecoveryState = await evaluate(
      client,
      `(() => ({
        hasMessage: document.body.innerText.includes('刷新恢复当前会话内容。'),
        draftValue: document.querySelector('textarea')?.value,
        activeCount: document.querySelectorAll('.conversation-item-shell.active').length,
      }))()`,
    )
      if (!reloadRecoveryState.hasMessage || reloadRecoveryState.draftValue !== '' || reloadRecoveryState.activeCount !== 1) {
        throw new Error(`Reload recovery failed: ${JSON.stringify(reloadRecoveryState)}`)
      }
      Object.assign(groupResults, {
        suggestionState,
        suggestionDuringGeneration,
        themePersistenceState,
        themeStreamingState,
        reloadRecoveryState,
      })
      console.log('UI stage: send failures, timeout, done handling, and fast actions')
      await resetPage(client)
    await setPlan(client, [
      { kind: 'httpError', status: 500 },
      { kind: 'networkError', message: 'Failed to fetch' },
      { kind: 'abruptClose', chunks: ['部分正文已经到达。'], interval: 20, message: 'network lost' },
      { kind: 'extraAfterDone', chunks: ['done 前内容。'], extraContent: 'done 后不应显示。', interval: 20 },
      { kind: 'success', chunks: ['快速点击只发送一次。'], interval: 80 },
      { kind: 'success', chunks: ['超时后恢复成功。'], interval: 20 },
    ])
    await ask(client, 'HTTP 500 错误')
    await waitFor(client, `document.body.innerText.includes('请求失败：500')`)
    await waitIdle(client)
    await ask(client, '网络错误')
    await waitFor(client, `document.body.innerText.includes('Failed to fetch')`)
    await waitIdle(client)
    await ask(client, '中途网络断开')
    await waitFor(
      client,
      `document.body.innerText.includes('部分正文已经到达。') &&
        document.body.innerText.includes('响应中断') &&
        document.body.innerText.includes('复制') &&
        document.body.innerText.includes('重试')`,
    )
    await waitIdle(client)
    await ask(client, 'done 后多余内容')
    await waitFor(client, `document.body.innerText.includes('done 前内容。')`)
    await waitIdle(client)
    const extraAfterDoneState = await evaluate(
      client,
      `(() => ({
        hasExpected: document.body.innerText.includes('done 前内容。'),
        hasExtra: document.body.innerText.includes('done 后不应显示。'),
      }))()`,
    )
    if (!extraAfterDoneState.hasExpected || extraAfterDoneState.hasExtra) {
      throw new Error(`Extra after done was rendered: ${JSON.stringify(extraAfterDoneState)}`)
    }

    const fastBeforeAskCount = await evaluate(client, `window.__askCount`)
    await typeText(client, '快速连续点击发送')
    await evaluate(
      client,
      `(() => {
        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      })()`,
    )
    await waitFor(client, `document.body.innerText.includes('快速点击只发送一次。')`)
    await waitIdle(client)
    const fastSubmitState = await evaluate(
      client,
      `(() => ({
        askCountDelta: window.__askCount - ${fastBeforeAskCount},
        userRows: [...document.querySelectorAll('.message-row.user')]
          .filter((row) => row.innerText.includes('快速连续点击发送')).length,
      }))()`,
    )
    if (fastSubmitState.askCountDelta !== 1 || fastSubmitState.userRows !== 1) {
      throw new Error(`Fast submit caused duplicate request: ${JSON.stringify(fastSubmitState)}`)
    }

    await setPlan(client, [
      { kind: 'success', chunks: ['这条不会及时返回。'], firstDelay: 16000, interval: 20 },
      { kind: 'success', chunks: ['超时后恢复成功。'], interval: 20 },
    ])
    await setMockFlags(client, { cancelDelayMs: 2500 })
    await ask(client, '等待超时')
    await waitFor(client, `document.body.innerText.includes('响应超时或连接中断')`, 20000)
    const asksBeforePrematureRetry = await evaluate(client, `window.__askCount`)
    await typeText(client, '取消完成前不发送')
    await evaluate(
      client,
      `document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`,
    )
    await delay(100)
    const timeoutCancellationState = await evaluate(
      client,
      `(() => ({
        askCountUnchanged: window.__askCount === ${asksBeforePrematureRetry},
        cancelStarted: window.__cancelCount === 1,
        cancelCompleted: window.__cancelCompletedCount,
        textareaDisabled: document.querySelector('textarea')?.disabled === true,
      }))()`,
    )
    if (
      !timeoutCancellationState.askCountUnchanged ||
      !timeoutCancellationState.cancelStarted ||
      timeoutCancellationState.cancelCompleted !== 0 ||
      !timeoutCancellationState.textareaDisabled
    ) {
      throw new Error(`Timeout cancellation lock failed: ${JSON.stringify(timeoutCancellationState)}`)
    }
    await waitFor(client, `window.__cancelCompletedCount === 1`)
    await waitIdle(client)
    await setMockFlags(client, { cancelDelayMs: 0 })
    await ask(client, '超时后恢复')
    await waitFor(client, `document.body.innerText.includes('超时后恢复成功。')`)
    await waitIdle(client)
    const timeoutRecoveryState = await evaluate(
      client,
      `(() => ({
        hasTimeout: document.body.innerText.includes('响应超时或连接中断'),
        hasTimedOutQuestion: document.body.innerText.includes('等待超时'),
        hasRecovery: document.body.innerText.includes('超时后恢复成功。'),
        userRows: document.querySelectorAll('.message-row.user').length,
        editableUserRows: document.querySelectorAll('.message-row.user button[aria-label="编辑消息"]').length,
      }))()`,
    )
    if (
      timeoutRecoveryState.hasTimeout ||
      timeoutRecoveryState.hasTimedOutQuestion ||
      !timeoutRecoveryState.hasRecovery ||
      timeoutRecoveryState.editableUserRows !== timeoutRecoveryState.userRows
    ) {
      throw new Error(`Timeout recovery failed: ${JSON.stringify(timeoutRecoveryState)}`)
    }

    await resetPage(client)
    await setPlan(client, [
      { kind: 'malformedNdjson' },
      { kind: 'noDoneClose', chunks: ['没有 done 的响应。'], interval: 20 },
      { kind: 'persistedNoDone', chunks: ['服务端已保存的回答。'], interval: 20 },
      {
        kind: 'streamError',
        chunks: ['上游部分正文。'],
        message: '上游模型响应未完整结束，请重试',
        interval: 20,
      },
      { kind: 'success', chunks: ['异常后恢复成功。'], interval: 20 },
    ])
    await ask(client, '前端损坏 NDJSON')
    await waitFor(client, `document.body.innerText.includes('Unexpected') || document.body.innerText.includes('JSON')`)
    await waitIdle(client)
    await ask(client, '前端没有 done')
    await waitFor(client, `document.body.innerText.includes('响应未完整结束')`)
    await waitIdle(client)
    const recoveryQueriesBeforePersistedDone = await evaluate(
      client,
      `window.__requestResultQueryCount`,
    )
    await ask(client, '服务端保存后 done 丢失')
    await waitFor(
      client,
      `(() => {
        const rows = [...document.querySelectorAll('.message-row.assistant')];
        const last = rows.at(-1);
        return last?.innerText.includes('服务端已保存的回答。') &&
          !last?.innerText.includes('响应未完整结束');
      })()`,
    )
    await waitIdle(client)
    const persistedDoneRecoveryState = await evaluate(
      client,
      `(() => {
        const rows = [...document.querySelectorAll('.message-row.assistant')];
        const last = rows.at(-1);
        const stored = window.__getMockState().conversations
          .flatMap((conversation) => conversation.messages)
          .filter((message) => message.content === '服务端已保存的回答。');
        return {
          recoveredText: last?.innerText.includes('服务端已保存的回答。'),
          hasRecoveryError: last?.innerText.includes('响应未完整结束'),
          persistedAnswerCount: stored.length,
          requestResultQueries: window.__requestResultQueryCount - ${recoveryQueriesBeforePersistedDone},
        };
      })()`,
    )
    if (
      !persistedDoneRecoveryState.recoveredText ||
      persistedDoneRecoveryState.hasRecoveryError ||
      persistedDoneRecoveryState.persistedAnswerCount !== 1 ||
      persistedDoneRecoveryState.requestResultQueries !== 1
    ) {
      throw new Error(`Persisted done recovery failed: ${JSON.stringify(persistedDoneRecoveryState)}`)
    }
    const persistedMessagesBeforeIncomplete = await evaluate(
      client,
      `window.__getMockState().conversations
        .reduce((total, conversation) => total + conversation.messages.length, 0)`,
    )
    await ask(client, '上游不完整响应')
    await waitFor(
      client,
      `document.body.innerText.includes('上游部分正文。') &&
        document.body.innerText.includes('上游模型响应未完整结束，请重试')`,
    )
    await waitIdle(client)
    const incompleteStreamState = await evaluate(
      client,
      `(() => ({
        hasPartialText: document.body.innerText.includes('上游部分正文。'),
        hasIncompleteError: document.body.innerText.includes('上游模型响应未完整结束，请重试'),
        persistedMessagesDelta: window.__getMockState().conversations
          .reduce((total, conversation) => total + conversation.messages.length, 0) -
          ${persistedMessagesBeforeIncomplete},
      }))()`,
    )
    if (
      !incompleteStreamState.hasPartialText ||
      !incompleteStreamState.hasIncompleteError ||
      incompleteStreamState.persistedMessagesDelta !== 0
    ) {
      throw new Error(`Incomplete stream UI state failed: ${JSON.stringify(incompleteStreamState)}`)
    }
    await ask(client, '前端异常后恢复')
    await waitFor(client, `document.body.innerText.includes('异常后恢复成功。')`)
    Object.assign(groupResults, {
      extraAfterDoneState,
      fastSubmitState,
      timeoutCancellationState,
      timeoutRecoveryState,
      persistedDoneRecoveryState,
      incompleteStreamState,
    })
  return groupResults
}

runScenarioModule(import.meta.url, 'stream-recovery', runStreamRecovery)
