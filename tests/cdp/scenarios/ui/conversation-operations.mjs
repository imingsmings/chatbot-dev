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

export async function runConversationOperations(client) {
  const groupResults = {}
  await resetPage(client)
      console.log('UI stage: initialization, sidebar, dialogs, and API failures')
    const initialState = await evaluate(
      client,
      `(() => {
        const userMenuTrigger = document.querySelector('.user-menu-trigger');
        const userAvatar = document.querySelector('.user-avatar');
        return {
          hasSidebar: Boolean(document.querySelector('.sidebar')),
          hasEmptyState: Boolean(document.querySelector('.empty-state')),
          suggestionCount: document.querySelectorAll('.suggestion-card').length,
          activeCount: document.querySelectorAll('.conversation-item-shell.active').length,
          sendDisabled: [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '发送')?.disabled === true,
          textareaDisabled: document.querySelector('textarea')?.disabled === false,
          pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
          userMenuHeight: userMenuTrigger?.getBoundingClientRect().height,
          userAvatarSize: userAvatar?.getBoundingClientRect().width,
          userAvatarSource: userAvatar?.getAttribute('src'),
          userAvatarLoaded: userAvatar instanceof HTMLImageElement && userAvatar.complete && userAvatar.naturalWidth > 0,
          userName: userMenuTrigger?.querySelector('.user-name')?.textContent?.trim(),
          userMenuIconCount: userMenuTrigger?.querySelectorAll('svg').length,
        };
      })()`,
    )
    if (
      !initialState.hasSidebar ||
      !initialState.hasEmptyState ||
      initialState.suggestionCount !== 4 ||
      initialState.activeCount !== 1 ||
      !initialState.sendDisabled ||
      !initialState.textareaDisabled ||
      initialState.pageOverflowX ||
      initialState.userMenuHeight !== 44 ||
      initialState.userAvatarSize !== 32 ||
      initialState.userAvatarSource !== '/assets/jw.svg' ||
      !initialState.userAvatarLoaded ||
      initialState.userName !== 'Jason Wang' ||
      initialState.userMenuIconCount !== 1
    ) {
      throw new Error(`Initial UI state failed: ${JSON.stringify(initialState)}`)
    }

    const oldDataMessages = [
      { role: 'user', content: '旧格式用户消息' },
      { role: 'assistant', content: '旧格式助手消息，没有 reasoning 字段' },
    ]
    const manyConversations = Array.from({ length: 48 }, (_, index) => ({
      id: `ui-seed-${index + 1}`,
      title:
        index === 0
          ? '这是一个非常非常非常非常非常非常长的会话标题用于测试侧栏省略和按钮布局'
          : `侧栏会话 ${index + 1}`,
      createdAt: new Date(Date.now() - index * 1000).toISOString(),
      updatedAt: new Date(Date.now() - index * 1000).toISOString(),
      messages: index === 0
        ? oldDataMessages
        : [
            { role: 'user', content: `会话 ${index + 1} 用户消息` },
            { role: 'assistant', content: `会话 ${index + 1} 助手消息` },
          ],
    }))
    await seedConversations(client, manyConversations)
    await client.send('Page.reload')
    await waitFor(client, `document.body.innerText.includes('旧格式助手消息，没有 reasoning 字段')`)
    const sidebarUsesPopup = await evaluate(
      client,
      `(() => {
        const trigger = document.querySelector('.conversation-item-shell.active .conversation-menu-trigger');
        if (!trigger) return false;
        trigger.click();
        return true;
      })()`,
    )
    if (sidebarUsesPopup) {
      await waitFor(client, `Boolean(document.querySelector('.conversation-actions-menu'))`)
    }
    const sidebarState = await evaluate(
      client,
      `(() => {
        const panel = document.querySelector('.conversation-panel');
        const title = document.querySelector('.conversation-title');
        const activeShell = document.querySelector('.conversation-item-shell.active');
        const actionRoot = document.querySelector('.conversation-actions-menu') || activeShell;
        const actionRects = [...actionRoot.querySelectorAll('.conversation-action-btn')]
          .map((button) => button.getBoundingClientRect());
        const actionLabels = [...actionRoot.querySelectorAll('.conversation-action-btn')]
          .map((button) => button.textContent.trim());
        const chatScrollRect = document.querySelector('.chat-scroll').getBoundingClientRect();
        const firstUserMessageRect = document.querySelector('.message-row.user .message-text')
          .getBoundingClientRect();
        return {
          count: document.querySelectorAll('.conversation-item-shell').length,
          panelScrollable: panel.scrollHeight > panel.clientHeight,
          activeCount: document.querySelectorAll('.conversation-item-shell.active').length,
          longTitleConstrained: title.scrollWidth >= title.clientWidth,
          actionLabels,
          actionsVisible: actionRects.length === 3 && actionRects.every((rect) => rect.width > 0 && rect.height > 0),
          hasReasoningPanelForOldData: Boolean(document.querySelector('.reasoning-panel')),
          chatScrollRect: {
            top: Math.round(chatScrollRect.top),
            right: Math.round(chatScrollRect.right),
            bottom: Math.round(chatScrollRect.bottom),
          },
          firstUserMessageRect: {
            top: Math.round(firstUserMessageRect.top),
            right: Math.round(firstUserMessageRect.right),
            bottom: Math.round(firstUserMessageRect.bottom),
          },
          firstUserMessageFullyVisible:
            firstUserMessageRect.top >= chatScrollRect.top &&
            firstUserMessageRect.right <= chatScrollRect.right &&
            firstUserMessageRect.bottom <= chatScrollRect.bottom,
          pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
        };
      })()`,
    )
    if (
      sidebarState.count !== manyConversations.length ||
      !sidebarState.panelScrollable ||
      sidebarState.activeCount !== 1 ||
      !sidebarState.longTitleConstrained ||
      JSON.stringify(sidebarState.actionLabels) !== JSON.stringify(['导出', '重命名', '删除']) ||
      !sidebarState.actionsVisible ||
      sidebarState.hasReasoningPanelForOldData ||
      !sidebarState.firstUserMessageFullyVisible ||
      sidebarState.pageOverflowX
    ) {
      throw new Error(`Sidebar boundary assertions failed: ${JSON.stringify(sidebarState)}`)
    }
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })

    const titleBeforeRename = await evaluate(
      client,
      `document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim()`,
    )
    await clickConversationActionAt(client, 0, '重命名')
    await waitForDialog(client, '重命名会话')
    await cancelDialog(client)
    await clickConversationActionAt(client, 0, '重命名')
    await waitForDialog(client, '重命名会话')
    await submitPromptDialog(client, '   ')
    await setMockFlags(client, { failNextRename: true })
    await clickConversationActionAt(client, 0, '重命名')
    await waitForDialog(client, '重命名会话')
    await submitPromptDialog(client, '失败的新标题', { waitForClose: false })
    await waitForDialog(client, '操作失败')
    await confirmDialog(client, '知道了')
    await delay(500)
    const renameState = await evaluate(
      client,
      `(() => ({
        title: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
        count: document.querySelectorAll('.conversation-item-shell').length,
      }))()`,
    )
    if (renameState.title !== titleBeforeRename || renameState.count !== manyConversations.length) {
      throw new Error(`Rename cancel/blank/failure assertions failed: ${JSON.stringify(renameState)}`)
    }

    await waitFor(
      client,
      `document.querySelector('.user-menu-trigger')?.disabled !== true ||
        document.querySelector('.clear-history-btn')?.disabled === false`,
    )
    await clickConversationActionAt(client, 0, '删除')
    await waitForDialog(client, '删除会话')
    await cancelDialog(client)
    const deleteCancelCount = await evaluate(client, `document.querySelectorAll('.conversation-item-shell').length`)
    if (deleteCancelCount !== manyConversations.length) {
      throw new Error(`Delete cancel removed a conversation: ${deleteCancelCount}`)
    }

    await clickConversationActionAt(client, 1, '删除')
    await waitForDialog(client, '删除会话')
    await confirmDialog(client, '删除')
    await delay(100)
    const afterMouseDeleteState = await evaluate(
      client,
      `(() => ({
        domCount: document.querySelectorAll('.conversation-item-shell').length,
        mockCount: window.__mockSnapshot().conversations.length,
      }))()`,
    )
    if (
      afterMouseDeleteState.domCount === manyConversations.length &&
      afterMouseDeleteState.mockCount === manyConversations.length
    ) {
      await invokeConversationActionAt(client, 1, '删除')
      await waitForDialog(client, '删除会话')
      await confirmDialog(client, '删除')
    }
    try {
      await waitFor(client, `document.querySelectorAll('.conversation-item-shell').length === ${manyConversations.length - 1}`)
    } catch (err) {
      const deleteDebugState = await evaluate(
        client,
        `(() => ({
          domCount: document.querySelectorAll('.conversation-item-shell').length,
          activeTitle: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
          userMenuTriggerDisabled: document.querySelector('.user-menu-trigger')?.disabled,
          snapshot: window.__mockSnapshot(),
        }))()`,
      )
      throw new Error(`Delete non-current did not update list: ${JSON.stringify(deleteDebugState)}`)
    }
    const deleteNonCurrentState = await evaluate(
      client,
      `(() => ({
        count: document.querySelectorAll('.conversation-item-shell').length,
        activeText: document.querySelector('.message-list')?.innerText || '',
        activeTitle: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
      }))()`,
    )
    if (
      deleteNonCurrentState.count !== manyConversations.length - 1 ||
      !deleteNonCurrentState.activeText.includes('旧格式助手消息') ||
      deleteNonCurrentState.activeTitle !== titleBeforeRename
    ) {
      throw new Error(`Delete non-current conversation failed: ${JSON.stringify(deleteNonCurrentState)}`)
    }

    await typeText(client, '清空取消前草稿')
    await clickText(client, 'button', '清空当前会话')
    await waitForDialog(client, '清空当前会话')
    await cancelDialog(client)
    const clearCancelState = await evaluate(
      client,
      `(() => ({
        value: document.querySelector('textarea')?.value,
        text: document.querySelector('.message-list')?.innerText || '',
      }))()`,
    )
    if (clearCancelState.value !== '清空取消前草稿' || !clearCancelState.text.includes('旧格式助手消息')) {
      throw new Error(`Clear cancel failed: ${JSON.stringify(clearCancelState)}`)
    }

    await setMockFlags(client, { failNextCreate: true })
    await clickText(client, 'button', '新建')
    await waitForDialog(client, '操作失败')
    await confirmDialog(client, '知道了')
    const newChatFailureState = await evaluate(
      client,
      `(() => ({
        text: document.querySelector('.message-list')?.innerText || '',
        activeTitle: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
      }))()`,
    )
    if (!newChatFailureState.text.includes('旧格式助手消息') || newChatFailureState.activeTitle !== titleBeforeRename) {
      throw new Error(`New chat failure changed current state: ${JSON.stringify(newChatFailureState)}`)
    }

    await setMockFlags(client, { failNextDetail: true })
    await clickConversationAt(client, 1)
    await waitForDialog(client, '操作失败')
    await confirmDialog(client, '知道了')
    const switchFailureState = await evaluate(
      client,
      `(() => ({
        text: document.querySelector('.message-list')?.innerText || '',
        activeTitle: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
      }))()`,
    )
    if (!switchFailureState.text.includes('旧格式助手消息') || switchFailureState.activeTitle !== titleBeforeRename) {
      throw new Error(`Switch failure changed current state: ${JSON.stringify(switchFailureState)}`)
    }

    await seedConversations(client, [{
      id: 'ui-only-one',
      title: '唯一会话',
      messages: [
        { role: 'user', content: '唯一会话用户消息' },
        { role: 'assistant', content: '唯一会话助手消息' },
      ],
    }])
    await client.send('Page.reload')
    await waitFor(client, `document.body.innerText.includes('唯一会话助手消息')`)
    await clickConversationActionAt(client, 0, '删除')
    await waitForDialog(client, '删除会话')
    await confirmDialog(client, '删除')
    await waitFor(
      client,
      `document.querySelector('.empty-state') &&
        document.querySelectorAll('.conversation-item-shell').length === 1 &&
        document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.includes('0 条消息') &&
        document.activeElement === document.querySelector('textarea')`,
    )
    const deleteLastState = await evaluate(
      client,
      `(() => ({
        isEmpty: Boolean(document.querySelector('.empty-state')),
        count: document.querySelectorAll('.conversation-item-shell').length,
        canFocusComposer: document.activeElement === document.querySelector('textarea'),
      }))()`,
    )
    if (!deleteLastState.isEmpty || deleteLastState.count !== 1 || !deleteLastState.canFocusComposer) {
      throw new Error(`Delete last conversation failed: ${JSON.stringify(deleteLastState)}`)
    }

    console.log('UI stage: edit and regenerate create recoverable conversation branches')
    const branchingSource = {
      id: 'ui-branch-source',
      title: 'R15 原会话',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:01:00.000Z',
      messages: [
        { role: 'user', content: '第一轮问题' },
        { role: 'assistant', content: '第一轮回答' },
        { role: 'user', content: '第二轮原问题' },
        { role: 'assistant', content: '第二轮原回答' },
      ],
    }
    await seedConversations(client, [branchingSource])
    await client.send('Page.reload')
    await waitFor(client, `document.body.innerText.includes('第二轮原回答')`)
    await evaluate(
      client,
      `(() => {
        const row = [...document.querySelectorAll('.message-row.user')][1];
        const button = row?.querySelector('button[aria-label="编辑消息"]');
        if (!button) throw new Error('Cannot find second user edit action');
        button.click();
      })()`,
    )
    await waitForDialog(client, '编辑消息并创建分支')
    const branchingDialogState = await evaluate(
      client,
      `(() => {
        const input = document.querySelector('.modal-content[role="dialog"] .dialog-input');
        return {
          tagName: input?.tagName,
          value: input?.value,
          label: document.querySelector('.modal-content[role="dialog"] .dialog-label')?.textContent.trim(),
          explainsSourceSafety: document.querySelector('.modal-content[role="dialog"]')?.innerText.includes('原会话保持不变'),
        };
      })()`,
    )
    if (
      branchingDialogState.tagName !== 'TEXTAREA' ||
      branchingDialogState.value !== '第二轮原问题' ||
      branchingDialogState.label !== '用户消息' ||
      !branchingDialogState.explainsSourceSafety
    ) {
      throw new Error(`Branch edit dialog failed: ${JSON.stringify(branchingDialogState)}`)
    }

    await setPlan(client, [{
      kind: 'success',
      chunks: ['编辑后的分支回答'],
      firstDelay: 240,
      interval: 40,
    }])
    await submitPromptDialog(client, '第二轮编辑后的问题')
    await waitFor(client, `window.__mockSnapshot().conversations.length === 2`)
    const branchOperationState = await evaluate(
      client,
      `(() => ({
        activeTitle: document.querySelector('.conversation-item-shell.active .conversation-title')?.textContent.trim(),
        composerDisabled: document.querySelector('.composer textarea')?.disabled === true,
        hasStop: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止'),
        messageActionsDisabled: [...document.querySelectorAll(
          'button[aria-label="编辑消息"], button[aria-label="重新生成回答"]',
        )]
          .every((button) => button.matches(':disabled, [data-disabled], [aria-disabled="true"]')),
      }))()`,
    )
    if (
      branchOperationState.activeTitle !== 'R15 原会话（分支）' ||
      !branchOperationState.composerDisabled ||
      !branchOperationState.hasStop ||
      !branchOperationState.messageActionsDisabled
    ) {
      throw new Error(`Branch operation state failed: ${JSON.stringify(branchOperationState)}`)
    }
    await waitFor(client, `document.body.innerText.includes('编辑后的分支回答')`)
    await waitIdle(client)
    const branchState = await evaluate(
      client,
      `(() => {
        const snapshot = window.__mockSnapshot();
        const source = snapshot.conversations.find((item) => item.id === 'ui-branch-source');
        const branch = snapshot.conversations.find((item) => item.id !== 'ui-branch-source');
        return {
          count: snapshot.conversations.length,
          sourceMessages: source?.messages,
          branchId: branch?.id,
          branchTitle: branch?.title,
          branchMessages: branch?.messages,
          activeText: document.querySelector('.message-list')?.innerText || '',
        };
      })()`,
    )
    if (
      branchState.count !== 2 ||
      JSON.stringify(branchState.sourceMessages) !== JSON.stringify(branchingSource.messages) ||
      branchState.branchTitle !== 'R15 原会话（分支）' ||
      JSON.stringify(branchState.branchMessages) !== JSON.stringify([
        { role: 'user', content: '第一轮问题' },
        { role: 'assistant', content: '第一轮回答' },
        { role: 'user', content: '第二轮编辑后的问题' },
        { role: 'assistant', content: '编辑后的分支回答', reasoningContent: undefined, reasoningDurationMs: undefined },
      ]) ||
      !branchState.activeText.includes('第二轮编辑后的问题') ||
      !branchState.activeText.includes('编辑后的分支回答') ||
      branchState.activeText.includes('第二轮原回答')
    ) {
      throw new Error(`Edited branch assertions failed: ${JSON.stringify(branchState)}`)
    }

    await setPlan(client, [{
      kind: 'success',
      chunks: ['重新生成的分支回答'],
      firstDelay: 80,
      interval: 20,
    }])
    await evaluate(
      client,
      `(() => {
        const buttons = [...document.querySelectorAll('button[aria-label="重新生成回答"]')];
        const button = buttons.at(-1);
        if (!button) throw new Error('Cannot find regenerate action');
        button.click();
      })()`,
    )
    await waitFor(client, `window.__mockSnapshot().conversations.length === 3`)
    await waitFor(client, `document.body.innerText.includes('重新生成的分支回答')`)
    await waitIdle(client)
    const regenerateState = await evaluate(
      client,
      `(() => {
        const snapshot = window.__mockSnapshot();
        const source = snapshot.conversations.find((item) => item.id === 'ui-branch-source');
        const firstBranch = snapshot.conversations.find((item) => item.id === ${JSON.stringify(branchState.branchId)});
        const regenerated = snapshot.conversations.find(
          (item) => item.id !== 'ui-branch-source' && item.id !== ${JSON.stringify(branchState.branchId)},
        );
        return {
          count: snapshot.conversations.length,
          sourceMessages: source?.messages,
          firstBranchMessages: firstBranch?.messages,
          regeneratedTitle: regenerated?.title,
          regeneratedMessages: regenerated?.messages,
          activeText: document.querySelector('.message-list')?.innerText || '',
        };
      })()`,
    )
    if (
      regenerateState.count !== 3 ||
      JSON.stringify(regenerateState.sourceMessages) !== JSON.stringify(branchingSource.messages) ||
      JSON.stringify(regenerateState.firstBranchMessages) !== JSON.stringify(branchState.branchMessages) ||
      regenerateState.regeneratedTitle !== 'R15 原会话（分支）' ||
      JSON.stringify(regenerateState.regeneratedMessages) !== JSON.stringify([
        { role: 'user', content: '第一轮问题' },
        { role: 'assistant', content: '第一轮回答' },
        { role: 'user', content: '第二轮编辑后的问题' },
        { role: 'assistant', content: '重新生成的分支回答', reasoningContent: undefined, reasoningDurationMs: undefined },
      ]) ||
      !regenerateState.activeText.includes('重新生成的分支回答') ||
      regenerateState.activeText.includes('编辑后的分支回答')
    ) {
      throw new Error(`Regenerate branch assertions failed: ${JSON.stringify(regenerateState)}`)
    }

    await setMockFlags(client, { failNextBranch: true })
    await evaluate(
      client,
      `(() => {
        const buttons = [...document.querySelectorAll('button[aria-label="编辑消息"]')];
        const button = buttons.at(-1);
        if (!button) throw new Error('Cannot find branch failure edit action');
        button.click();
      })()`,
    )
    await waitForDialog(client, '编辑消息并创建分支')
    await submitPromptDialog(client, '这次分支会失败', { waitForClose: false })
    await waitForDialog(client, '创建分支失败')
    const branchFailureState = await evaluate(
      client,
      `(() => ({
        count: window.__mockSnapshot().conversations.length,
        activeText: document.querySelector('.message-list')?.innerText || '',
      }))()`,
    )
    if (
      branchFailureState.count !== 3 ||
      !branchFailureState.activeText.includes('重新生成的分支回答') ||
      branchFailureState.activeText.includes('这次分支会失败')
    ) {
      throw new Error(`Branch failure recovery failed: ${JSON.stringify(branchFailureState)}`)
    }
    await confirmDialog(client, '知道了')
    Object.assign(groupResults, {
      branchingDialogState,
      branchOperationState,
      branchState,
      regenerateState,
      branchFailureState,
    })

      await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      chunks: ['新建前正在生成。', '这条请求应该被中断。'],
      interval: 300,
      done: false,
    }])
    await ask(client, '测试新建时中断')
    await waitFor(client, `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`)
    await clickText(client, 'button', '新建')
    await waitFor(
      client,
      `document.querySelector('.empty-state') &&
        document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.includes('0 条消息')`,
    )
    const newChatAbortCount = await waitFor(client, `window.__abortCount > 0 && window.__abortCount`)
    await screenshot(client, '05-new-chat-aborts-generation')

    console.log('UI stage: switch and generating operations')
    await resetPage(client)
    await setPlan(client, [
      { kind: 'success', chunks: ['第一会话历史内容。'], interval: 20 },
      { kind: 'success', chunks: ['第二会话正在生成。', '第二会话后续内容。'], interval: 250, done: false },
    ])
    await ask(client, '第一会话问题')
    await waitFor(client, `document.body.innerText.includes('第一会话历史内容。')`)
    await waitIdle(client)
    await clickText(client, 'button', '新建')
    await waitFor(client, `Boolean(document.querySelector('.empty-state'))`)
    await ask(client, '第二会话生成中')
    await waitFor(client, `document.body.innerText.includes('第二会话正在生成。')`)
    await clickConversationAt(client, 1)
    await waitFor(client, `document.body.innerText.includes('第一会话历史内容。') && !document.body.innerText.includes('第二会话正在生成。')`)
    const switchAbortCount = await waitFor(client, `window.__abortCount > 0 && window.__abortCount`)

    console.log('UI stage: composer draft reset across conversations')
    await resetPage(client)
    await setPlan(client, [{ kind: 'success', chunks: ['第一会话已保存。'], interval: 20 }])
    await ask(client, '第一会话问题')
    await waitFor(client, `document.body.innerText.includes('第一会话已保存。')`)
    await waitIdle(client)
    await typeText(client, '新建前未发送草稿')
    await clickText(client, 'button', '新建')
    await waitFor(
      client,
      `document.querySelector('.empty-state') && document.querySelector('textarea')?.value === ''`,
    )
    const newChatDraftValue = await evaluate(client, `document.querySelector('textarea')?.value`)

    await typeText(client, '第二会话未发送草稿')
    await clickConversationAt(client, 1)
    await waitFor(
      client,
      `document.body.innerText.includes('第一会话已保存。') &&
        document.querySelector('textarea')?.value === ''`,
    )
    const switchDraftValue = await evaluate(client, `document.querySelector('textarea')?.value`)

    await typeText(client, '删除当前会话前未发送草稿')
    const activeConversationIndex = await evaluate(
      client,
      `[...document.querySelectorAll('.conversation-item-shell')]
        .findIndex((shell) => shell.classList.contains('active'))`,
    )
    await clickConversationActionAt(client, activeConversationIndex, '删除')
    await waitForDialog(client, '删除会话')
    await confirmDialog(client, '删除')
    await waitFor(
      client,
      `document.querySelector('.empty-state') &&
        document.querySelector('textarea')?.value === '' &&
        document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.includes('0 条消息')`,
    )
    const deleteDraftState = await evaluate(
      client,
      `(() => ({
        value: document.querySelector('textarea')?.value,
        activeCount: document.querySelectorAll('.conversation-item-shell.active').length,
        activeMeta: document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.trim(),
      }))()`,
    )
    if (newChatDraftValue !== '' || switchDraftValue !== '' || deleteDraftState.value !== '') {
      throw new Error(
        `Composer draft reset failed: ${JSON.stringify({
          newChatDraftValue,
          switchDraftValue,
          deleteDraftState,
        })}`,
      )
    }

    await setPlan(client, [{ kind: 'success', chunks: ['清空前会话内容。'], interval: 20 }])
    await ask(client, '清空当前会话前的问题')
    await waitFor(client, `document.body.innerText.includes('清空前会话内容。')`)
    await waitIdle(client)
    await typeText(client, '清空当前会话前未发送草稿')
    await clickText(client, 'button', '清空当前会话')
    await waitForDialog(client, '清空当前会话')
    await confirmDialog(client, '清空')
    await waitFor(
      client,
      `document.querySelector('.empty-state') &&
        document.querySelector('textarea')?.value === '' &&
        document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.includes('0 条消息')`,
    )
    const clearDraftState = await evaluate(
      client,
      `(() => ({
        value: document.querySelector('textarea')?.value,
        activeMeta: document.querySelector('.conversation-item-shell.active .conversation-meta')?.textContent.trim(),
        isEmpty: Boolean(document.querySelector('.empty-state')),
      }))()`,
    )
    if (clearDraftState.value !== '' || !clearDraftState.isEmpty) {
      throw new Error(`Clear conversation draft reset failed: ${JSON.stringify(clearDraftState)}`)
    }

    await resetPage(client)
    await setPlan(client, [{
      kind: 'success',
      chunks: ['生成中会话操作内容。'],
      interval: 300,
      done: false,
    }])
    await ask(client, '生成中操作')
    await waitFor(client, `document.body.innerText.includes('生成中会话操作内容。')`)
    const operationBeforeCount = await evaluate(
      client,
      `document.querySelectorAll('.conversation-title').length`,
    )
    const operationUsesUserMenu = await evaluate(
      client,
      `(() => {
        const trigger = document.querySelector('.user-menu-trigger');
        if (!trigger) return false;
        trigger.click();
        return true;
      })()`,
    )
    if (operationUsesUserMenu) {
      await waitFor(client, `Boolean(document.querySelector('.sidebar-user-menu'))`)
    }
    const userOperationState = await evaluate(
      client,
      `(() => ({
        clearDisabled: [...(document.querySelector('.sidebar-user-menu') || document.querySelector('.sidebar-footer')).querySelectorAll('button')]
          .find((button) => button.textContent.trim() === '清空当前会话')?.matches(':disabled, [data-disabled], [aria-disabled="true"]') === true,
        importDisabled: [...(document.querySelector('.sidebar-user-menu') || document.querySelector('.sidebar-footer')).querySelectorAll('button')]
          .find((button) => button.textContent.trim() === '导入 JSON')?.matches(':disabled, [data-disabled], [aria-disabled="true"]') === true,
        exportAllDisabled: [...(document.querySelector('.sidebar-user-menu') || document.querySelector('.sidebar-footer')).querySelectorAll('button')]
          .find((button) => button.textContent.trim() === '导出全部 JSON')?.matches(':disabled, [data-disabled], [aria-disabled="true"]') === true,
      }))()`,
    )
    if (operationUsesUserMenu) {
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    }

    const generatingActiveIndex = await evaluate(
      client,
      `[...document.querySelectorAll('.conversation-item-shell')]
        .findIndex((shell) => shell.classList.contains('active'))`,
    )
    const operationUsesConversationMenu = await evaluate(
      client,
      `(() => {
        const shell = document.querySelectorAll('.conversation-item-shell')[${generatingActiveIndex}];
        const trigger = shell?.querySelector('.conversation-menu-trigger');
        if (!trigger) return false;
        trigger.click();
        return true;
      })()`,
    )
    if (operationUsesConversationMenu) {
      await waitFor(client, `Boolean(document.querySelector('.conversation-actions-menu'))`)
    }
    const conversationOperationState = await evaluate(
      client,
      `(() => {
        const shell = document.querySelectorAll('.conversation-item-shell')[${generatingActiveIndex}];
        const root = document.querySelector('.conversation-actions-menu') || shell;
        return {
          singleExportDisabled: root.querySelector('.conversation-action-btn[aria-label="导出 Markdown"]')?.matches(':disabled, [data-disabled], [aria-disabled="true"]') === true,
          deleteDisabled: root.querySelector('.conversation-action-btn.danger')?.matches(':disabled, [data-disabled], [aria-disabled="true"]') === true,
          renameEnabled: root.querySelector('.conversation-action-btn[aria-label="重命名"]')?.matches(':disabled, [data-disabled], [aria-disabled="true"]') === false,
        };
      })()`,
    )
    await evaluate(
      client,
      `(() => {
        const shell = document.querySelectorAll('.conversation-item-shell')[${generatingActiveIndex}];
        const root = document.querySelector('.conversation-actions-menu') || shell;
        root.querySelector('.conversation-action-btn[aria-label="重命名"]')?.click();
      })()`,
    )
    await waitForDialog(client, '重命名会话')
    await submitPromptDialog(client, '生成中重命名成功')
    await waitFor(client, `document.body.innerText.includes('生成中重命名成功')`)
    if (
      !userOperationState.clearDisabled ||
      !userOperationState.importDisabled ||
      !userOperationState.exportAllDisabled ||
      !conversationOperationState.singleExportDisabled ||
      !conversationOperationState.deleteDisabled ||
      !conversationOperationState.renameEnabled ||
      operationBeforeCount !== await evaluate(client, `document.querySelectorAll('.conversation-title').length`)
    ) {
      throw new Error(
        `Generating conversation operation state failed: ${JSON.stringify({
          userOperationState,
          conversationOperationState,
          operationBeforeCount,
          operationAfterCount: await evaluate(client, `document.querySelectorAll('.conversation-title').length`),
        })}`,
      )
    }
    await clickText(client, 'button', '停止')
    await waitFor(client, `document.body.innerText.includes('已停止生成')`)
    await waitIdle(client)

    await resetPage(client)
    await typeText(client, '   ')
    const blankSubmitState = await evaluate(
      client,
      `(() => {
        document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return {
          askCount: window.__askCount,
          sendDisabled: [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '发送')?.disabled === true,
        };
      })()`,
    )
    await setPlan(client, [{ kind: 'success', chunks: ['Enter 提交成功。'], interval: 20 }])
    await typeText(client, 'Enter 提交')
    await evaluate(
      client,
      `document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }))`,
    )
    await waitFor(client, `document.body.innerText.includes('Enter 提交成功。')`)
    await waitIdle(client)
    const enterSubmitCount = await evaluate(client, `window.__askCount`)
    await typeText(client, 'Shift Enter 不提交')
    await evaluate(
      client,
      `document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }))`,
    )
    await delay(200)
    const shiftEnterSubmitCount = await evaluate(client, `window.__askCount`)
    await typeText(client, Array.from({ length: 12 }, (_, index) => '多行输入内容 ' + index).join('\\n'))
    const tallHeight = await evaluate(client, `document.querySelector('textarea').offsetHeight`)
    await setPlan(client, [{ kind: 'success', chunks: ['输入框恢复成功。'], interval: 20 }])
    await ask(client, '输入框发送后恢复')
    await waitFor(client, `document.body.innerText.includes('输入框恢复成功。')`)
    await waitIdle(client)
    const composerState = await evaluate(
      client,
      `(() => ({
        blankAskCount: ${blankSubmitState.askCount},
        blankSendDisabled: ${blankSubmitState.sendDisabled},
        enterSubmitCount: ${enterSubmitCount},
        shiftEnterSubmitCount: ${shiftEnterSubmitCount},
        tallHeight: ${tallHeight},
        finalHeight: document.querySelector('textarea').offsetHeight,
        textareaDisabled: document.querySelector('textarea').disabled,
      }))()`,
    )
      if (
        !composerState.blankSendDisabled ||
        composerState.enterSubmitCount !== composerState.blankAskCount + 1 ||
        composerState.shiftEnterSubmitCount !== composerState.enterSubmitCount ||
        composerState.tallHeight <= composerState.finalHeight
      ) {
        throw new Error('Composer behavior assertions failed')
      }
      Object.assign(groupResults, {
        newChatAbortCount,
        switchAbortCount,
        newChatDraftValue,
        switchDraftValue,
        deleteDraftState,
        clearDraftState,
        userOperationState,
        conversationOperationState,
        composerState,
      })
  return groupResults
}

runScenarioModule(import.meta.url, 'conversation-operations', runConversationOperations)
