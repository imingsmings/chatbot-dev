import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getPageTarget, launchChrome } from '../../helpers/browser.mjs'
import { CdpClient, evaluate } from '../../helpers/cdpClient.mjs'
import { delay, stopProcess } from '../../helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const APP_ORIGIN = new URL(APP_URL).origin
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9333)
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-screenshots')
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'

async function waitFor(client, expression, timeoutMs = 6000) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const result = await evaluate(client, expression)
    if (result) return result
    await delay(80)
  }

  throw new Error(`Timed out waiting for expression: ${expression}`)
}

async function waitForEvent(client, method, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Timed out waiting for CDP event: ${method}`))
    }, timeoutMs)

    client.on(method, (params) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(params)
    })
  })
}

async function navigateAndWait(client, url) {
  const loaded = waitForEvent(client, 'Page.loadEventFired')
  await client.send('Page.navigate', { url })
  await loaded
}

async function screenshot(client, name) {
  if (!CAPTURE_SCREENSHOTS) return null
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })
  const filePath = path.join(OUT_DIR, `${name}.png`)
  await writeFile(filePath, Buffer.from(result.data, 'base64'))
  console.log(filePath)
}

async function resetPage(client) {
  await navigateAndWait(client, 'about:blank')
  await waitFor(client, 'document.readyState === "complete"')
  await navigateAndWait(client, APP_URL)
  await waitFor(
    client,
    `location.href.startsWith(${JSON.stringify(APP_URL)}) && Boolean(document.querySelector("textarea"))`,
  )

  const isEmpty = await evaluate(client, 'Boolean(document.querySelector(".empty-state"))')
  if (!isEmpty) {
    await clickText(client, 'button', '新建')
    await waitFor(client, 'Boolean(document.querySelector("textarea") && document.querySelector(".empty-state"))')
  }
}

async function setPlan(client, plans) {
  await evaluate(client, `window.__setAskPlans(${JSON.stringify(plans)})`)
}

async function waitIdle(client) {
  await waitFor(
    client,
    `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '发送') &&
      ![...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`,
  )
}

async function ask(client, question) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        .set.call(input, ${JSON.stringify(question)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`,
  )
}

async function clickText(client, selector, text) {
  const clicked = await evaluate(
    client,
    `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((node) => node.textContent.trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`,
  )
  if (clicked) return

  const triggerSelector = ['导入 JSON/ZIP', '导出全部 ZIP', '清空当前会话'].includes(text)
    ? '.user-menu-trigger'
    : ['参数', '模板', '摘要', '上下文'].includes(text)
      ? '.chat-header .header-icon-btn[aria-label="更多操作"]'
      : null
  if (!triggerSelector) throw new Error(`Cannot find clickable text: ${text}`)

  await evaluate(
    client,
    `document.querySelector(${JSON.stringify(triggerSelector)})?.click()`,
  )
  await waitFor(
    client,
    `[...document.querySelectorAll(${JSON.stringify(selector)})]
      .some((node) => node.textContent.trim() === ${JSON.stringify(text)})`,
  )
  await evaluate(
    client,
    `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((node) => node.textContent.trim() === ${JSON.stringify(text)});
      if (!el) throw new Error('Cannot find menu action: ${text}');
      el.click();
    })()`,
  )
}

async function clickDialogButton(client, text) {
  await evaluate(
    client,
    `(() => {
      const dialog = document.querySelector('.modal-content[role="dialog"]');
      if (!dialog) throw new Error('Cannot find app dialog');
      const button = [...dialog.querySelectorAll('button')]
        .find((node) => node.textContent.trim() === ${JSON.stringify(text)});
      if (!button) throw new Error('Cannot find dialog button: ${text}');
      button.click();
    })()`,
  )
}

async function waitForDialog(client, title) {
  await waitFor(
    client,
    `document.querySelector('.modal-content[role="dialog"]')?.innerText.includes(${JSON.stringify(title)})`,
  )
}

async function cancelDialog(client) {
  await clickDialogButton(client, '取消')
  await waitFor(client, `!document.querySelector('.modal-content[role="dialog"]')`)
}

async function confirmDialog(client, label = '确定') {
  await clickDialogButton(client, label)
  await waitFor(client, `!document.querySelector('.modal-content[role="dialog"]')`)
}

async function submitPromptDialog(client, value, options = {}) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('.modal-content[role="dialog"] .dialog-input');
      if (!input) throw new Error('Cannot find dialog input');
      const prototype = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')
        .set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  )
  await clickDialogButton(client, '保存')

  if (options.waitForClose !== false) {
    await waitFor(client, `!document.querySelector('.modal-content[role="dialog"]')`)
  }
}

async function ensureClipboard(client) {
  await client.send('Page.bringToFront').catch(() => {})
  await client.send('Browser.grantPermissions', {
    origin: APP_ORIGIN,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  }).catch(() => {})
}

async function clickConversationAt(client, index) {
  await evaluate(
    client,
    `(() => {
      const item = [...document.querySelectorAll('.conversation-item')][${index}];
      if (!item) throw new Error('Cannot find conversation at index ${index}');
      item.click();
    })()`,
  )
}

async function clickConversationActionAt(client, index, title) {
  const usesPopup = await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')][${index}];
      if (!shell) throw new Error('Cannot find conversation shell at index ${index}');
      shell.scrollIntoView({ block: 'center', inline: 'nearest' });
      const trigger = shell.querySelector('.conversation-menu-trigger');
      if (trigger) {
        trigger.click();
        return true;
      }
      shell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
      return false;
    })()`,
  )
  if (usesPopup) {
    await waitFor(client, `Boolean(document.querySelector('.conversation-actions-menu'))`)
  }
  const rect = await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')][${index}];
      const root = document.querySelector('.conversation-actions-menu') || shell;
      const button = [...root.querySelectorAll('.conversation-action-btn')]
        .find((node) => node.getAttribute('aria-label') === ${JSON.stringify(title)} || node.textContent.trim() === ${JSON.stringify(title)});
      if (!button) throw new Error('Cannot find conversation action ${title} at index ${index}');
      button.focus();
      const rect = button.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })()`,
  )
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: rect.x,
    y: rect.y,
  })
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  })
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  })
}

async function invokeConversationActionAt(client, index, title) {
  const usesPopup = await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')][${index}];
      if (!shell) throw new Error('Cannot find conversation shell at index ${index}');
      const trigger = shell.querySelector('.conversation-menu-trigger');
      if (trigger) {
        trigger.click();
        return true;
      }
      return false;
    })()`,
  )
  if (usesPopup) {
    await waitFor(client, `Boolean(document.querySelector('.conversation-actions-menu'))`)
  }
  await evaluate(
    client,
    `(() => {
      const shell = [...document.querySelectorAll('.conversation-item-shell')][${index}];
      const root = document.querySelector('.conversation-actions-menu') || shell;
      const button = [...root.querySelectorAll('.conversation-action-btn')]
        .find((node) => node.getAttribute('aria-label') === ${JSON.stringify(title)} || node.textContent.trim() === ${JSON.stringify(title)});
      if (!button) throw new Error('Cannot find conversation action ${title} at index ${index}');
      button.click();
    })()`,
  )
}

async function clickFirstSuggestion(client) {
  await evaluate(
    client,
    `(() => {
      const item = document.querySelector('.suggestion-card');
      if (!item) throw new Error('Cannot find suggestion card');
      item.click();
    })()`,
  )
}

async function seedConversations(client, conversations) {
  await evaluate(client, `window.__resetMockData(${JSON.stringify(conversations)})`)
}

async function setMockFlags(client, flags) {
  await evaluate(client, `window.__setMockFlags(${JSON.stringify(flags)})`)
}

async function typeText(client, text) {
  await waitFor(client, `document.querySelector('.composer textarea') instanceof HTMLTextAreaElement`)
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('.composer textarea');
      if (!(input instanceof HTMLTextAreaElement)) {
        throw new Error('Cannot find composer textarea');
      }
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        .set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  )
}

function makeLongChunks(prefix, count) {
  return Array.from(
    { length: count },
    (_, index) => `${prefix} ${index + 1}. 这是一段用于拉长聊天内容的文本。\n`,
  )
}

function makeCodeBlockChunks(count) {
  return [
    '```ts\n',
    ...Array.from(
      { length: count },
      (_, index) => `const streamedRow${index + 1} = '代码块自动滚动第 ${index + 1} 行';\n`,
    ),
    '```',
  ]
}

const mockScript = `
(() => {
  const originalFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  let plans = [];
  let conversationSeq = 0;
  const requests = [];
  const conversations = new Map();
  const requestResults = new Map();
  const STORAGE_KEY = '__cdpMockConversations';
  const flags = {
    failNextCreate: false,
    failNextDetail: false,
    failNextRename: false,
    failNextDelete: false,
    failNextClear: false,
    failNextBranch: false,
    failNextModelOptions: false,
    modelOptionsDelayMs: 0,
    cancelDelayMs: 0,
  };
  window.__abortCount = 0;
  window.__askCount = 0;
  window.__requestResultQueryCount = 0;

  window.__setAskPlans = (nextPlans) => {
    plans = nextPlans.slice();
    window.__abortCount = 0;
    window.__askCount = 0;
    window.__requestResultQueryCount = 0;
  };

  window.__setMockFlags = (nextFlags) => {
    Object.assign(flags, nextFlags || {});
  };

  window.__getMockState = () => ({
    conversations: serializeConversations(),
  });

  function serializeConversations() {
    return [...conversations.values()].map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message })),
    }));
  }

  function persistMockData() {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializeConversations()));
  }

  function applyMockData(items = []) {
    conversations.clear();
    conversationSeq = 0;
    for (const item of items) {
      const numericId = String(item.id || '').match(/^ui-cdp-(\\d+)$/);
      conversationSeq = Math.max(
        conversationSeq + 1,
        numericId ? Number(numericId[1]) : 0,
      );
      const timestamp = item.updatedAt || item.createdAt || now();
      const conversation = {
        id: item.id || 'ui-cdp-' + conversationSeq,
        title: item.title || '新的聊天',
        createdAt: item.createdAt || timestamp,
        updatedAt: timestamp,
        messages: Array.isArray(item.messages) ? item.messages.map((message) => ({ ...message })) : [],
        modelOptions: item.modelOptions ? { ...item.modelOptions } : undefined,
      };
      conversations.set(conversation.id, conversation);
    }
  }

  window.__resetMockData = (items = []) => {
    applyMockData(items);
    persistMockData();
  };

  window.__mockSnapshot = () => ({
    conversations: serializeConversations(),
    requests: requests.slice(),
    askCount: window.__askCount,
    abortCount: window.__abortCount,
  });

  function consumeFlag(name) {
    const value = Boolean(flags[name]);
    flags[name] = false;
    return value;
  }

  const seededConversations = sessionStorage.getItem(STORAGE_KEY);
  if (seededConversations) {
    applyMockData(JSON.parse(seededConversations));
  }

  function line(event) {
    return encoder.encode(JSON.stringify(event) + '\\n');
  }

  function now() {
    return new Date().toISOString();
  }

  function defaultModelOptions() {
    return {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      temperature: 0.7,
      maxTokens: 4096,
      reasoningEnabled: true,
      reasoningEffort: 'medium',
    };
  }

  function summary(conversation) {
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
    };
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function streamHeaders(plan) {
    const headers = { 'Content-Type': 'application/x-ndjson; charset=utf-8' };

    if (!plan.omitProtocolHeader) {
      headers['X-Chat-Stream-Protocol'] = plan.protocolVersion || '2';
    }

    return headers;
  }

  function createConversation(title = '新的聊天') {
    conversationSeq += 1;
    const timestamp = now();
    const conversation = {
      id: 'ui-cdp-' + conversationSeq,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
      modelOptions: defaultModelOptions(),
    };
    conversations.set(conversation.id, conversation);
    persistMockData();
    return conversation;
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const parsed = new URL(url, window.location.origin);
    const pathname = parsed.pathname.replace(/^\\/api/, '');
    const method = (init.method || 'GET').toUpperCase();
    let requestBody = null;
    try {
      requestBody = init.body ? JSON.parse(init.body) : null;
    } catch {
      requestBody = init.body || null;
    }
    requests.push({ method, pathname, body: requestBody });

    if (pathname === '/auth/status' && method === 'GET') {
      return json({ enabled: false });
    }

    if (pathname === '/runtime-config' && method === 'GET') {
      return json({
        runtime: {
          profile: {
            name: 'Jason Wang',
            avatarUrl: '/assets/jw.svg',
          },
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          storageBackend: 'file',
          endpointConfigured: true,
          apiKeyConfigured: true,
          providers: [
            {
              id: 'deepseek',
              label: 'DeepSeek',
              configured: true,
              endpointConfigured: true,
              apiKeyConfigured: true,
              defaultModel: 'deepseek-v4-flash',
              models: [
                {
                  provider: 'deepseek',
                  id: 'deepseek-v4-flash',
                  label: 'DeepSeek V4 Flash',
                  capabilities: {
                    tools: true,
                    reasoning: true,
                    reasoningSummary: false,
                    reasoningEfforts: ['low', 'medium', 'high', 'max'],
                    temperature: true,
                    maxOutputTokens: 65536,
                  },
                },
                {
                  provider: 'deepseek',
                  id: 'deepseek-v4-pro',
                  label: 'DeepSeek V4 Pro',
                  capabilities: {
                    tools: true,
                    reasoning: true,
                    reasoningSummary: false,
                    reasoningEfforts: ['low', 'medium', 'high', 'max'],
                    temperature: true,
                    maxOutputTokens: 65536,
                  },
                },
                {
                  provider: 'deepseek',
                  id: 'deepseek-v4-flash-vision-exp',
                  label: 'DeepSeek V4 Flash Vision Exp',
                  capabilities: {
                    tools: true,
                    reasoning: true,
                    reasoningSummary: false,
                    reasoningEfforts: ['low', 'medium', 'high', 'max'],
                    temperature: true,
                    maxOutputTokens: 65536,
                    inputModalities: ['text', 'image'],
                    imageDetailLevels: ['auto', 'low', 'original'],
                    experimental: true,
                  },
                },
              ],
            },
            {
              id: 'openai',
              label: 'OpenAI',
              configured: true,
              endpointConfigured: true,
              apiKeyConfigured: true,
              defaultModel: 'gpt-5.6-luna',
              models: [
                {
                  provider: 'openai',
                  id: 'gpt-5.6-luna',
                  label: 'GPT-5.6 Luna',
                  capabilities: {
                    tools: true,
                    reasoning: true,
                    reasoningSummary: true,
                    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
                    temperature: false,
                    maxOutputTokens: 128000,
                  },
                },
                {
                  provider: 'openai',
                  id: 'gpt-5.6-sol',
                  label: 'GPT-5.6 Sol',
                  disabled: true,
                  capabilities: {
                    tools: true,
                    reasoning: true,
                    reasoningSummary: true,
                    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
                    temperature: false,
                    maxOutputTokens: 128000,
                  },
                },
              ],
            },
          ],
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            reasoningEnabled: true,
            reasoningEffort: 'medium',
          },
        },
      });
    }

    if (pathname === '/conversations' && method === 'GET') {
      return json({
        conversations: [...conversations.values()]
          .map(summary)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      });
    }

    if (pathname === '/conversations' && method === 'POST') {
      if (consumeFlag('failNextCreate')) {
        return json({ message: 'create failed' }, 500);
      }
      const body = JSON.parse(init.body || '{}');
      const conversation = createConversation(body.title || '新的聊天');
      return json({ conversation }, 201);
    }

    const detailMatch = pathname.match(/^\\/conversations\\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      if (consumeFlag('failNextDetail')) {
        return json({ message: 'detail failed' }, 500);
      }
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      return conversation ? json({ conversation }) : json({ message: 'not found' }, 404);
    }

    const modelOptionsMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/model-options$/);
    if (modelOptionsMatch && method === 'PATCH') {
      if (flags.modelOptionsDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, flags.modelOptionsDelayMs));
      }
      if (consumeFlag('failNextModelOptions')) {
        return json({ message: 'model options failed' }, 500);
      }
      const conversation = conversations.get(decodeURIComponent(modelOptionsMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      const body = JSON.parse(init.body || '{}');
      conversation.modelOptions = { ...body.options };
      persistMockData();
      return json({ conversation });
    }

    if (detailMatch && method === 'PATCH') {
      if (consumeFlag('failNextRename')) {
        return json({ message: 'rename failed' }, 500);
      }
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      const body = JSON.parse(init.body || '{}');
      conversation.title = body.title || conversation.title;
      conversation.updatedAt = now();
      persistMockData();
      return json({ conversation });
    }

    if (detailMatch && method === 'DELETE') {
      if (consumeFlag('failNextDelete')) {
        return json({ message: 'delete failed' }, 500);
      }
      const id = decodeURIComponent(detailMatch[1]);
      if (!conversations.has(id)) return json({ message: 'not found' }, 404);
      conversations.delete(id);
      persistMockData();
      return new Response(null, { status: 204 });
    }

    const clearMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/clear$/);
    if (clearMatch && method === 'POST') {
      if (consumeFlag('failNextClear')) {
        return json({ message: 'clear failed' }, 500);
      }
      const conversation = conversations.get(decodeURIComponent(clearMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      conversation.messages = [];
      conversation.updatedAt = now();
      persistMockData();
      return json({ conversation });
    }

    const branchMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/branches$/);
    if (branchMatch && method === 'POST') {
      if (consumeFlag('failNextBranch')) {
        return json({ message: 'branch failed' }, 500);
      }
      const source = conversations.get(decodeURIComponent(branchMatch[1]));
      if (!source) return json({ message: 'not found' }, 404);
      const body = JSON.parse(init.body || '{}');
      if (!Number.isInteger(body.messageIndex) || source.messages[body.messageIndex]?.role !== 'user') {
        return json({ message: 'invalid branch target' }, 400);
      }
      const suffix = '（分支）';
      const title = source.title.endsWith(suffix)
        ? source.title
        : source.title.slice(0, 200 - suffix.length) + suffix;
      const branch = createConversation(title);
      branch.messages = source.messages
        .slice(0, body.messageIndex)
        .map((message) => ({ ...message }));
      branch.modelOptions = source.modelOptions ? { ...source.modelOptions } : defaultModelOptions();
      persistMockData();
      return json({ conversation: branch }, 201);
    }

    const askMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/ask$/);

    if (pathname.startsWith('/requests/') && pathname.endsWith('/cancel') && method === 'POST') {
      if (flags.cancelDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, flags.cancelDelayMs));
      }
      return json({ cancelled: true });
    }

    const requestResultMatch = pathname.match(/^\\/requests\\/([^/]+)$/);
    if (requestResultMatch && method === 'GET') {
      window.__requestResultQueryCount += 1;
      const request = requestResults.get(decodeURIComponent(requestResultMatch[1]));
      return request ? json({ request }) : json({ message: 'request not found' }, 404);
    }

    if (url.includes('/api/history')) {
      return new Response(JSON.stringify({ conversations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/clear')) {
      return new Response(JSON.stringify({ message: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!askMatch) {
      return originalFetch(input, init);
    }

    const conversation = conversations.get(decodeURIComponent(askMatch[1]));
    if (!conversation) {
      return json({ message: 'not found' }, 404);
    }

    window.__askCount += 1;
    const body = JSON.parse(init.body || '{}');
    const question = body.question || '';
    const requestId = body.requestId || '';
    if (requestId) {
      requestResults.set(requestId, {
        requestId,
        conversationId: conversation.id,
        status: 'processing',
        createdAt: now(),
        updatedAt: now(),
      });
    }
    conversation.modelOptions = body.options ? { ...body.options } : defaultModelOptions();
    persistMockData();
    const plan = plans.shift() || { kind: 'success', chunks: ['默认回复'], interval: 40 };

    if (plan.kind === 'httpError') {
      if (requestId) requestResults.get(requestId).status = 'failed';
      return new Response('failed', { status: plan.status || 500 });
    }

    if (plan.kind === 'networkError') {
      if (requestId) requestResults.get(requestId).status = 'failed';
      throw new TypeError(plan.message || 'Failed to fetch');
    }

    const stream = new ReadableStream({
      start(controller) {
        let index = 0;
        let reasoningIndex = 0;
        let toolEventIndex = 0;
        let answer = '';
        let reasoning = '';
        let timer;
        let closed = false;

        const closeWithAbort = () => {
          if (closed) return;
          closed = true;
          window.__abortCount += 1;
          window.clearTimeout(timer);
          controller.error(new DOMException('Aborted', 'AbortError'));
        };

        if (init.signal?.aborted) {
          closeWithAbort();
          return;
        }

        init.signal?.addEventListener('abort', closeWithAbort, { once: true });

        const push = () => {
          if (closed) return;

          if (plan.kind === 'malformedNdjson') {
            if (requestId) requestResults.get(requestId).status = 'failed';
            controller.enqueue(encoder.encode('{bad json\\n'));
            closed = true;
            controller.close();
            return;
          }

          if (plan.kind === 'invalidReasoningEvent') {
            controller.enqueue(line({ type: 'reasoning_delta', content: 123 }));
            closed = true;
            controller.close();
            return;
          }

          if (plan.kind === 'invalidDoneEvent') {
            controller.enqueue(line({ type: 'done', reasoningDurationMs: 'bad' }));
            closed = true;
            controller.close();
            return;
          }

          if (reasoningIndex < (plan.reasoningChunks || []).length) {
            const chunk = plan.reasoningChunks[reasoningIndex];
            reasoning += chunk;
            controller.enqueue(line({ type: 'reasoning_delta', content: chunk }));
            reasoningIndex += 1;
            timer = window.setTimeout(push, plan.reasoningInterval ?? plan.interval ?? 80);
            return;
          }

          if (toolEventIndex < (plan.toolEvents || []).length) {
            controller.enqueue(line(plan.toolEvents[toolEventIndex]));
            toolEventIndex += 1;
            timer = window.setTimeout(push, plan.toolInterval ?? plan.interval ?? 80);
            return;
          }

          if (index < (plan.chunks || []).length) {
            const chunk = plan.chunks[index];
            answer += chunk;
            controller.enqueue(line({ type: 'delta', content: chunk }));
            index += 1;
            timer = window.setTimeout(push, plan.interval ?? 80);
            return;
          }

          if (plan.kind === 'streamError') {
            if (requestId) requestResults.get(requestId).status = 'failed';
            controller.enqueue(line({ type: 'error', message: plan.message || '模拟失败' }));
            closed = true;
            controller.close();
            return;
          }

          if (plan.kind === 'abruptClose') {
            if (requestId) requestResults.get(requestId).status = 'failed';
            closed = true;
            controller.error(new TypeError(plan.message || 'network lost'));
            return;
          }

          if (plan.done === false) {
            timer = window.setTimeout(push, plan.interval ?? 80);
            return;
          }

          if (plan.kind === 'noDoneClose') {
            if (requestId) requestResults.get(requestId).status = 'failed';
            closed = true;
            controller.close();
            return;
          }

          if (plan.kind === 'persistedNoDone') {
            conversation.messages.push(
              { role: 'user', content: question },
              { role: 'assistant', content: answer, status: 'completed' },
            );
            conversation.updatedAt = now();
            if (requestId) {
              Object.assign(requestResults.get(requestId), {
                status: 'completed',
                updatedAt: now(),
                messageStartIndex: conversation.messages.length - 2,
                messageCount: 2,
              });
            }
            persistMockData();
            closed = true;
            controller.close();
            return;
          }

          if (plan.kind === 'extraAfterDone') {
            controller.enqueue(line({ type: 'done' }));
            controller.enqueue(line({ type: 'delta', content: plan.extraContent || '不应该显示的内容' }));
            conversation.messages.push(
              { role: 'user', content: question },
              { role: 'assistant', content: answer },
            );
            conversation.updatedAt = now();
            persistMockData();
            closed = true;
            controller.close();
            return;
          }

          controller.enqueue(line({
            type: 'done',
            reasoningDurationMs: typeof plan.reasoningDurationMs === 'number'
              ? plan.reasoningDurationMs
              : reasoning
                ? 123
                : undefined,
          }));
          conversation.messages.push(
            { role: 'user', content: question },
            {
              role: 'assistant',
              content: answer,
              reasoningContent: reasoning || undefined,
              reasoningDurationMs: reasoning ? 123 : undefined,
            },
          );
          conversation.updatedAt = now();
          if (requestId) requestResults.get(requestId).status = 'completed';
          persistMockData();
          closed = true;
          controller.close();
        };

        timer = window.setTimeout(push, plan.firstDelay ?? 80);
      },
      cancel() {
        window.__abortCount += 1;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: streamHeaders(plan),
    });
  };
})();
`


async function createUiHarness(group) {
  await mkdir(OUT_DIR, { recursive: true })
  const { chrome } = await launchChrome({
    url: 'about:blank',
    debugPort: DEBUG_PORT,
    profilePrefix: `chatbot-cdp-${group}-`,
    windowSize: '1280,900',
  })
  let client

  try {
    const target = await getPageTarget(DEBUG_PORT, 'about:blank')
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Browser.grantPermissions', {
      origin: APP_ORIGIN,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    }).catch(() => {})
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript })
    await client.send('Page.navigate', { url: APP_URL })
    await resetPage(client)
    return { chrome, client }
  } catch (error) {
    client?.close()
    await stopProcess(chrome)
    throw error
  }
}

async function closeUiHarness({ chrome, client }) {
  client?.close()
  await stopProcess(chrome)
}

function runScenarioModule(moduleUrl, group, runner) {
  if (!process.argv[1] || moduleUrl !== pathToFileURL(process.argv[1]).href) return

  ;(async () => {
    const harness = await createUiHarness(group)
    try {
      const results = await runner(harness.client)
      console.log(JSON.stringify({ group, ...results }, null, 2))
    } finally {
      await closeUiHarness(harness)
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

export {
  ask,
  cancelDialog,
  clickConversationActionAt,
  clickConversationAt,
  clickDialogButton,
  clickFirstSuggestion,
  clickText,
  closeUiHarness,
  confirmDialog,
  createUiHarness,
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
}
