import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { waitForEval } from './helpers/appActions.mjs'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const DEBUG_PORT = Number(process.env.CDP_SIDEBAR_STATE_PORT || 9346)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const mockScript = `
(() => {
  const conversations = new Map([
    ['op-1', {
      id: 'op-1',
      title: 'Alpha Operation',
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:02:00.000Z',
      titleManuallyEdited: true,
      messages: [{ role: 'assistant', content: 'alpha message' }]
    }],
    ['op-2', {
      id: 'op-2',
      title: 'Beta Operation',
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:01:00.000Z',
      titleManuallyEdited: true,
      messages: [{ role: 'assistant', content: 'beta message' }]
    }]
  ]);
  const requests = [];
  const routeDelays = new Map();
  const failingRoutes = new Set();
  let conversationSequence = 0;

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function summary(conversation) {
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length
    };
  }

  function now() {
    return new Date().toISOString();
  }

  window.__setSidebarRouteDelay = (route, delayMs) => {
    routeDelays.set(route, delayMs);
  };
  window.__failSidebarRouteOnce = (route) => {
    failingRoutes.add(route);
  };
  window.__sidebarState = () => ({
    requests: requests.slice(),
    conversations: [...conversations.values()].map((conversation) => structuredClone(conversation))
  });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const parsed = new URL(url, window.location.origin);
    const pathname = parsed.pathname.replace(/^\\/api/, '');
    const method = (init.method || 'GET').toUpperCase();
    const route = method + ' ' + pathname;
    requests.push(route);

    if (pathname === '/auth/status' && method === 'GET') return json({ enabled: false });

    const delayMs = routeDelays.get(route) || 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (failingRoutes.delete(route)) {
      return json({ message: 'planned operation failure' }, 500);
    }

    if (pathname === '/runtime-config' && method === 'GET') {
      return json({
        runtime: {
          provider: 'deepseek',
          model: 'sidebar-state-model',
          storageBackend: 'file',
          endpointConfigured: true,
          apiKeyConfigured: true,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            reasoningEnabled: true,
            reasoningEffort: 'medium'
          }
        }
      });
    }

    if (pathname === '/conversations' && method === 'GET') {
      return json({
        conversations: [...conversations.values()]
          .map(summary)
          .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
      });
    }

    if (pathname === '/conversations' && method === 'POST') {
      conversationSequence += 1;
      const timestamp = now();
      const conversation = {
        id: 'op-new-' + conversationSequence,
        title: '新的聊天',
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: []
      };
      conversations.set(conversation.id, conversation);
      return json({ conversation }, 201);
    }

    const clearMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/clear$/);
    if (clearMatch && method === 'POST') {
      const conversation = conversations.get(decodeURIComponent(clearMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      conversation.messages = [];
      conversation.updatedAt = now();
      return json({ conversation });
    }

    const detailMatch = pathname.match(/^\\/conversations\\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      return conversation ? json({ conversation }) : json({ message: 'not found' }, 404);
    }

    if (detailMatch && method === 'PATCH') {
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      const body = JSON.parse(init.body || '{}');
      conversation.title = body.title;
      conversation.updatedAt = now();
      return json({ conversation });
    }

    if (detailMatch && method === 'DELETE') {
      const id = decodeURIComponent(detailMatch[1]);
      if (!conversations.delete(id)) return json({ message: 'not found' }, 404);
      return new Response(null, { status: 204 });
    }

    if (pathname.startsWith('/requests/') && pathname.endsWith('/cancel') && method === 'POST') {
      return json({ cancelled: true });
    }

    return json({ message: 'unexpected mock route: ' + route }, 500);
  };
})();
`

async function routeRequestCount(client, route) {
  return evaluate(
    client,
    `window.__sidebarState().requests.filter((item) => item === ${JSON.stringify(route)}).length`,
  )
}

async function setRouteDelay(client, route, delayMs) {
  await evaluate(
    client,
    `window.__setSidebarRouteDelay(${JSON.stringify(route)}, ${delayMs})`,
  )
}

async function clickButtonRepeated(client, text, clickCount = 3) {
  if (text === '清空当前会话') {
    const usesUserMenu = await evaluate(
      client,
      `(() => {
        const trigger = document.querySelector('.user-menu-trigger');
        if (!trigger) return false;
        trigger.click();
        return true;
      })()`,
    )
    if (usesUserMenu) {
      await waitForEval(client, `Boolean(document.querySelector('.sidebar-user-menu'))`)
    }
  }
  await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) =>
          item.textContent.trim() === ${JSON.stringify(text)} ||
          item.getAttribute('aria-label') === ${JSON.stringify(text)}
        );
      if (!button) throw new Error('button not found: ${text}');
      for (let index = 0; index < ${clickCount}; index += 1) button.click();
    })()`,
  )
}

async function clickConversationRepeated(client, title, clickCount = 3) {
  await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')]
        .find((item) => item.innerText.includes(${JSON.stringify(title)}));
      const button = shell?.querySelector('.conversation-item');
      if (!button) throw new Error('conversation not found: ${title}');
      for (let index = 0; index < ${clickCount}; index += 1) button.click();
    })()`,
  )
}

async function clickConversationActionRepeated(client, title, action, clickCount = 3) {
  const usesPopup = await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')]
        .find((item) => item.innerText.includes(${JSON.stringify(title)}));
      const trigger = shell?.querySelector('.conversation-menu-trigger');
      if (trigger) {
        trigger.click();
        return true;
      }
      return false;
    })()`,
  )
  if (usesPopup) {
    await waitForEval(client, `Boolean(document.querySelector('.conversation-actions-menu'))`)
  }
  await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')]
        .find((item) => item.innerText.includes(${JSON.stringify(title)}));
      const root = document.querySelector('.conversation-actions-menu') || shell;
      const button = [...root.querySelectorAll('.conversation-action-btn')]
        .find((item) =>
          item.getAttribute('aria-label') === ${JSON.stringify(action)} ||
          item.textContent.trim() === ${JSON.stringify(action)}
        );
      if (!button) throw new Error('conversation action not found: ${title} / ${action}');
      for (let index = 0; index < ${clickCount}; index += 1) button.click();
    })()`,
  )
}

async function confirmDialogRepeated(client, label, promptValue) {
  await evaluate(
    client,
    `(() => {
      const dialog = document.querySelector('.app-dialog');
      if (!dialog) throw new Error('dialog not found');
      const input = dialog.querySelector('input');
      if (input && ${promptValue !== undefined}) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
          .set.call(input, ${JSON.stringify(promptValue ?? '')});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const button = [...dialog.querySelectorAll('button')]
        .find((item) => item.textContent.trim() === ${JSON.stringify(label)});
      if (!button) throw new Error('dialog button not found: ${label}');
      for (let index = 0; index < 3; index += 1) button.click();
    })()`,
  )
}

async function main() {
  const { chrome } = await launchChrome({
    url: 'about:blank',
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-sidebar-state-',
    windowSize: '1280,900',
  })
  let client
  const assertions = {}

  try {
    const target = await getPageTarget(DEBUG_PORT, 'about:blank')
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript })
    await client.send('Page.navigate', { url: APP_URL })
    await waitForEval(
      client,
      `document.body.innerText.includes('Alpha Operation') &&
        document.querySelector('.new-chat-btn')?.disabled === false`,
    )

    await setRouteDelay(client, 'POST /conversations', 220)
    const createBefore = await routeRequestCount(client, 'POST /conversations')
    await clickButtonRepeated(client, '新建')
    await waitForEval(
      client,
      `document.querySelector('.new-chat-btn')?.textContent.trim() === '新建中...' &&
        document.querySelector('.new-chat-btn')?.disabled === true &&
        document.querySelector('.composer textarea')?.disabled === true`,
    )
    const createDuring = await routeRequestCount(client, 'POST /conversations')
    assert(createDuring - createBefore === 1, 'rapid new-chat clicks created duplicate requests')
    await waitForEval(
      client,
      `document.querySelector('.new-chat-btn')?.textContent.trim() === '新建' &&
        document.querySelector('.new-chat-btn')?.disabled === false &&
        Boolean(document.querySelector('.empty-state'))`,
    )
    assertions.create = { requestCount: createDuring - createBefore, recovered: true }

    await setRouteDelay(client, 'POST /conversations', 0)
    const emptyConversationCreateBefore = await routeRequestCount(client, 'POST /conversations')
    await clickButtonRepeated(client, '新建')
    await waitForEval(
      client,
      `document.querySelector('.new-chat-btn')?.disabled === false &&
        Boolean(document.querySelector('.empty-state'))`,
    )
    const emptyConversationCreateAfter = await routeRequestCount(client, 'POST /conversations')
    assert(
      emptyConversationCreateAfter - emptyConversationCreateBefore === 0,
      'repeated new-chat clicks created another empty conversation',
    )
    assertions.emptyConversationReuse = {
      requestCount: emptyConversationCreateAfter - emptyConversationCreateBefore,
      expectedRequestCount: 0,
      recovered: true,
    }

    await setRouteDelay(client, 'GET /conversations/op-2', 220)
    const selectBefore = await routeRequestCount(client, 'GET /conversations/op-2')
    await clickConversationRepeated(client, 'Beta Operation')
    await waitForEval(
      client,
      `(() => {
        const shell = [...document.querySelectorAll('.conversation-item-shell')]
          .find((item) => item.innerText.includes('Beta Operation'));
        return shell?.querySelector('.conversation-meta')?.textContent.trim() === '加载中...' &&
          shell.querySelector('.conversation-item')?.disabled === true &&
          document.querySelector('.composer textarea')?.disabled === true;
      })()`,
    )
    const selectDuring = await routeRequestCount(client, 'GET /conversations/op-2')
    assert(selectDuring - selectBefore === 1, 'rapid conversation switches created duplicate requests')
    await waitForEval(
      client,
      `document.querySelector('.conversation-item-shell.active')?.innerText.includes('Beta Operation') &&
        document.querySelector('.composer textarea')?.disabled === false`,
    )
    assertions.select = { requestCount: selectDuring - selectBefore, recovered: true }

    await setRouteDelay(client, 'PATCH /conversations/op-2', 220)
    const renameBefore = await routeRequestCount(client, 'PATCH /conversations/op-2')
    await clickConversationActionRepeated(client, 'Beta Operation', '重命名')
    await waitForEval(client, `document.querySelector('.modal-header')?.innerText.includes('重命名会话')`)
    await confirmDialogRepeated(client, '保存', 'Beta Renamed')
    await waitForEval(
      client,
      `(() => {
        const shell = [...document.querySelectorAll('.conversation-item-shell')]
          .find((item) => item.innerText.includes('Beta Operation'));
        return shell?.querySelector('.conversation-menu-trigger')?.getAttribute('aria-busy') === 'true' ||
          [...(shell?.querySelectorAll('.conversation-action-btn') || [])]
            .some((item) => item.textContent.trim() === '保存中...' && item.disabled);
      })()`,
    )
    const renameDuring = await routeRequestCount(client, 'PATCH /conversations/op-2')
    assert(renameDuring - renameBefore === 1, 'rapid rename clicks created duplicate requests')
    await waitForEval(
      client,
      `document.body.innerText.includes('Beta Renamed') &&
        !document.body.innerText.includes('保存中...')`,
    )
    assertions.rename = { requestCount: renameDuring - renameBefore, recovered: true }

    await setRouteDelay(client, 'POST /conversations/op-2/clear', 220)
    const clearBefore = await routeRequestCount(client, 'POST /conversations/op-2/clear')
    await clickButtonRepeated(client, '清空当前会话')
    await waitForEval(client, `document.querySelector('.modal-header')?.innerText.includes('清空当前会话')`)
    await confirmDialogRepeated(client, '清空')
    await waitForEval(
      client,
      `(() => {
        const userTriggerBusy = document.querySelector('.user-menu-trigger')?.getAttribute('aria-label') === '清空中...' &&
          document.querySelector('.user-menu-trigger')?.getAttribute('aria-busy') === 'true';
        const clearButtonBusy = document.querySelector('.clear-history-btn')?.textContent.trim() === '清空中...' &&
          document.querySelector('.clear-history-btn')?.disabled === true;
        return (userTriggerBusy || clearButtonBusy) &&
          document.querySelector('.composer textarea')?.disabled === true;
      })()`,
    )
    const clearDuring = await routeRequestCount(client, 'POST /conversations/op-2/clear')
    assert(clearDuring - clearBefore === 1, 'rapid clear clicks created duplicate requests')
    await waitForEval(
      client,
      `document.querySelector('.conversation-item-shell.active .conversation-meta')
        ?.textContent.includes('0 条消息') &&
        (document.querySelector('.user-menu-trigger')?.getAttribute('aria-label') === '用户设置' ||
          document.querySelector('.clear-history-btn')?.textContent.trim() === '清空当前会话')`,
    )
    assertions.clear = { requestCount: clearDuring - clearBefore, recovered: true }

    await setRouteDelay(client, 'DELETE /conversations/op-1', 220)
    const deleteBefore = await routeRequestCount(client, 'DELETE /conversations/op-1')
    await clickConversationActionRepeated(client, 'Alpha Operation', '删除')
    await waitForEval(client, `document.querySelector('.modal-header')?.innerText.includes('删除会话')`)
    await confirmDialogRepeated(client, '删除')
    await waitForEval(
      client,
      `(() => {
        const shell = [...document.querySelectorAll('.conversation-item-shell')]
          .find((item) => item.innerText.includes('Alpha Operation'));
        return shell?.querySelector('.conversation-menu-trigger')?.getAttribute('aria-busy') === 'true' ||
          [...(shell?.querySelectorAll('.conversation-action-btn') || [])]
            .some((item) => item.textContent.trim() === '删除中...' && item.disabled);
      })()`,
    )
    const deleteDuring = await routeRequestCount(client, 'DELETE /conversations/op-1')
    assert(deleteDuring - deleteBefore === 1, 'rapid delete clicks created duplicate requests')
    await waitForEval(client, `!document.body.innerText.includes('Alpha Operation')`)
    assertions.delete = { requestCount: deleteDuring - deleteBefore, recovered: true }

    await setRouteDelay(client, 'POST /conversations', 160)
    await evaluate(client, `window.__failSidebarRouteOnce('POST /conversations')`)
    const failedCreateBefore = await routeRequestCount(client, 'POST /conversations')
    await clickButtonRepeated(client, '新建')
    await waitForEval(client, `document.querySelector('.modal-header')?.innerText.includes('操作失败')`)
    const failedCreateDuring = await routeRequestCount(client, 'POST /conversations')
    assert(
      failedCreateDuring - failedCreateBefore === 1,
      'rapid failed create clicks created duplicate requests',
    )
    await confirmDialogRepeated(client, '知道了')
    await waitForEval(
      client,
      `document.querySelector('.new-chat-btn')?.disabled === false &&
        document.querySelector('.new-chat-btn')?.textContent.trim() === '新建'`,
    )
    assertions.errorRecovery = {
      requestCount: failedCreateDuring - failedCreateBefore,
      recovered: true,
    }

    assert(
      Object.values(assertions).every(
        (item) =>
          item.requestCount === (item.expectedRequestCount ?? 1) && item.recovered === true,
      ),
      'one or more sidebar operation assertions failed',
    )

    console.log(JSON.stringify({ allPassed: true, assertions }, null, 2))
  } finally {
    client?.close()
    await stopProcess(chrome)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
