import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { screenshot, waitForEval } from './helpers/appActions.mjs'
import { stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const DEBUG_PORT = Number(process.env.CDP_VISION_PORT || 9351)
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-image-attachments-screenshots')
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZP4sAAAAASUVORK5CYII='

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const mockScript = String.raw`
(() => {
  window.__visionDocumentId = crypto.randomUUID();
  const originalFetch = window.fetch.bind(window);
  const storageKey = 'chatbot-vision-cdp-state';
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZP4sAAAAASUVORK5CYII=';
  let restored = null;
  try { restored = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch {}
  const conversations = restored?.conversations || [];
  const imageBytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
  const attachments = new Map((restored?.attachments || []).map((item) => [item.id, {
    ...item,
    blob: new Blob([imageBytes], { type: item.mediaType }),
  }]));
  const requests = [];
  const uploadAttempts = new Map(restored?.uploadAttempts || []);
  let conversationSequence = restored?.conversationSequence || 0;
  let attachmentSequence = restored?.attachmentSequence || 0;
  let answerSequence = restored?.answerSequence || 0;
  let branchCount = restored?.branchCount || 0;
  let slowNextAsk = false;
  let activeAsk = null;

  const persist = () => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        answerSequence,
        attachmentSequence,
        attachments: [...attachments.values()].map(({ blob, ...item }) => item),
        branchCount,
        conversationSequence,
        conversations,
        uploadAttempts: [...uploadAttempts],
      }));
    } catch {}
  };

  const model = (id, label, images) => ({
    provider: 'deepseek', id, label,
    capabilities: {
      tools: true,
      reasoning: true,
      reasoningSummary: false,
      reasoningEfforts: ['low', 'medium', 'high', 'max'],
      temperature: true,
      maxOutputTokens: 65536,
      inputModalities: images ? ['text', 'image'] : ['text'],
      ...(images ? { imageDetailLevels: ['auto', 'low', 'original'], experimental: true } : {}),
    },
  });
  const defaultOptions = () => ({
    provider: 'deepseek',
    model: 'deepseek-v4-flash-vision-exp',
    reasoningEnabled: true,
    reasoningEffort: 'high',
  });
  const summarize = (conversation) => ({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  });
  const createConversation = (title = '新的聊天') => {
    const timestamp = new Date().toISOString();
    const conversation = {
      id: 'vision-conversation-' + (++conversationSequence),
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
      titleManuallyEdited: false,
      messages: [],
      modelOptions: defaultOptions(),
    };
    conversations.unshift(conversation);
    persist();
    return conversation;
  };
  const json = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  const ndjson = (events) => new Response(
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'X-Chat-Stream-Protocol': '2',
      },
    },
  );
  const publicAttachment = (stored) => ({
    id: stored.id,
    kind: 'image',
    filename: stored.filename,
    mediaType: stored.mediaType,
    byteSize: stored.blob.size,
    width: 1,
    height: 1,
    detail: stored.detail,
  });
  const persistAnswer = (conversation, body, status, content) => {
    const selected = (body.attachmentIds || []).map((id) => publicAttachment(attachments.get(id)));
    conversation.messages.push({
      role: 'user',
      content: body.question || '',
      ...(selected.length ? { attachments: selected } : {}),
    }, {
      role: 'assistant',
      content,
      status,
      reasoningContent: 'Mock Vision reasoning',
      reasoningDurationMs: 25,
      generation: {
        provider: 'deepseek',
        model: body.options?.model || conversation.modelOptions.model,
        finishReason: status === 'completed' ? 'stop' : undefined,
        firstTokenLatencyMs: 10,
        totalDurationMs: 40,
        ...(status === 'completed' ? { usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } } : {}),
      },
    });
    conversation.updatedAt = new Date().toISOString();
    persist();
  };

  window.__visionState = () => ({
    answerSequence,
    branchCount,
    conversations: structuredClone(conversations),
    requests: requests.slice(),
    uploadAttempts: Object.fromEntries(uploadAttempts),
  });
  window.__visionSetSlowAsk = () => { slowNextAsk = true; };

  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input.url;
    const parsed = new URL(rawUrl, window.location.origin);
    const pathname = parsed.pathname.replace(/^\/api/, '');
    const method = (init.method || 'GET').toUpperCase();
    let body = null;
    if (init.body instanceof FormData) {
      body = init.body;
    } else {
      try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body || null; }
    }
    requests.push({
      method,
      pathname,
      body: body instanceof FormData ? { multipart: true } : body,
    });

    if (pathname === '/auth/status') return json({ enabled: false });
    if (pathname === '/runtime-config') {
      return json({ runtime: {
        provider: 'deepseek',
        model: 'deepseek-v4-flash-vision-exp',
        storageBackend: 'file',
        endpointConfigured: true,
        apiKeyConfigured: true,
        providers: [{
          id: 'deepseek',
          label: 'DeepSeek',
          configured: true,
          endpointConfigured: true,
          apiKeyConfigured: true,
          defaultModel: 'deepseek-v4-flash-vision-exp',
          models: [
            model('deepseek-v4-flash', 'DeepSeek V4 Flash', false),
            model('deepseek-v4-pro', 'DeepSeek V4 Pro', false),
            model('deepseek-v4-flash-vision-exp', 'DeepSeek V4 Flash Vision Exp', true),
          ],
        }],
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          reasoningEnabled: true,
          reasoningEffort: 'high',
        },
      }});
    }
    if (pathname === '/conversations/search') return json({ conversations: [] });
    if (pathname === '/conversations' && method === 'GET') {
      return json({ conversations: conversations.map(summarize) });
    }
    if (pathname === '/conversations' && method === 'POST') {
      return json({ conversation: createConversation() }, 201);
    }

    const attachmentMatch = pathname.match(/^\/conversations\/([^/]+)\/attachments(?:\/([^/]+))?$/);
    if (attachmentMatch) {
      const conversationId = decodeURIComponent(attachmentMatch[1]);
      const attachmentId = attachmentMatch[2] ? decodeURIComponent(attachmentMatch[2]) : null;
      const conversation = conversations.find((item) => item.id === conversationId);
      if (!conversation) return json({ message: '会话不存在' }, 404);
      if (method === 'POST' && !attachmentId && body instanceof FormData) {
        const file = body.get('image');
        const detail = body.get('detail') || 'auto';
        if (!(file instanceof File)) return json({ message: '请选择要上传的图片' }, 400);
        const attempts = (uploadAttempts.get(file.name) || 0) + 1;
        uploadAttempts.set(file.name, attempts);
        if (file.name === 'retry.png' && attempts === 1) {
          return json({ message: 'Mock 图片上传失败' }, 500);
        }
        const id = 'att_00000000-0000-4000-8000-' + String(++attachmentSequence).padStart(12, '0');
        const stored = {
          id,
          conversationId,
          filename: file.name,
          mediaType: file.type || 'image/png',
          blob: file,
          detail,
        };
        attachments.set(id, stored);
        persist();
        return json({ attachment: publicAttachment(stored) }, 201);
      }
      const stored = attachments.get(attachmentId);
      if (!stored || stored.conversationId !== conversationId) return json({ message: '附件不存在' }, 404);
      if (method === 'GET') {
        return new Response(stored.blob, {
          status: 200,
          headers: { 'Content-Type': stored.mediaType, 'Cache-Control': 'private, max-age=300' },
        });
      }
      if (method === 'DELETE') {
        attachments.delete(attachmentId);
        persist();
        return new Response(null, { status: 204 });
      }
    }

    const branchMatch = pathname.match(/^\/conversations\/([^/]+)\/branches$/);
    if (branchMatch && method === 'POST') {
      const source = conversations.find((item) => item.id === decodeURIComponent(branchMatch[1]));
      if (!source) return json({ message: '会话不存在' }, 404);
      const selected = source.messages[body.messageIndex];
      const branch = createConversation(source.title.endsWith('（分支）') ? source.title : source.title + '（分支）');
      branch.messages = source.messages.slice(0, body.messageIndex).map((message) => structuredClone(message));
      branch.modelOptions = structuredClone(source.modelOptions);
      const draftAttachments = (selected?.attachments || []).map((item) => {
        const original = attachments.get(item.id);
        const id = 'att_00000000-0000-4000-8000-' + String(++attachmentSequence).padStart(12, '0');
        const copied = { ...original, id, conversationId: branch.id };
        attachments.set(id, copied);
        return publicAttachment(copied);
      });
      branchCount += 1;
      persist();
      return json({ conversation: branch, draftAttachments }, 201);
    }

    const conversationMatch = pathname.match(/^\/conversations\/([^/]+)(?:\/(ask|model-options))?$/);
    if (conversationMatch) {
      const conversation = conversations.find((item) => item.id === decodeURIComponent(conversationMatch[1]));
      if (!conversation) return json({ message: '会话不存在' }, 404);
      const action = conversationMatch[2];
      if (!action && method === 'GET') return json({ conversation });
      if (action === 'model-options' && method === 'PATCH') {
        conversation.modelOptions = structuredClone(body.options);
        persist();
        return json({ conversation });
      }
      if (action === 'ask' && method === 'POST') {
        const ids = body.attachmentIds || [];
        if (ids.length && body.options?.model !== 'deepseek-v4-flash-vision-exp') {
          return json({ message: '当前模型不支持图片' }, 400);
        }
        answerSequence += 1;
        if (slowNextAsk) {
          slowNextAsk = false;
          const partial = 'MOCK_VISION_PARTIAL';
          const response = new Response(new ReadableStream({
            start(controller) {
              activeAsk = { body, conversation, controller, partial };
              controller.enqueue(new TextEncoder().encode(
                JSON.stringify({ type: 'reasoning_delta', content: 'Mock Vision reasoning' }) + '\n' +
                JSON.stringify({ type: 'delta', content: partial }) + '\n'
              ));
              init.signal?.addEventListener('abort', () => {
                try { controller.error(new DOMException('Aborted', 'AbortError')); } catch {}
              }, { once: true });
            },
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/x-ndjson; charset=utf-8',
              'X-Chat-Stream-Protocol': '2',
            },
          });
          return response;
        }
        const answer = 'MOCK_VISION_ANSWER_' + answerSequence;
        persistAnswer(conversation, body, 'completed', answer);
        return ndjson([
          { type: 'reasoning_delta', content: 'Mock Vision reasoning' },
          { type: 'delta', content: answer },
          { type: 'done', reasoningDurationMs: 25 },
        ]);
      }
    }

    if (/^\/requests\/[^/]+\/cancel$/.test(pathname) && method === 'POST') {
      if (activeAsk) {
        persistAnswer(activeAsk.conversation, activeAsk.body, 'stopped', activeAsk.partial);
        activeAsk = null;
      }
      return json({ cancelled: true, completed: true });
    }
    return originalFetch(input, init);
  };
})();
`

async function uploadImage(client, filename) {
  await evaluate(client, `(() => {
    const input = document.querySelector('.composer input[accept*="image"]');
    if (!input) throw new Error('image input missing');
    const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_BASE64)}), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(filename)}, { type: 'image/png' }));
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
}

async function submit(client, text = '') {
  await evaluate(client, `(() => {
    const textarea = document.querySelector('.composer textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
      .set.call(textarea, ${JSON.stringify(text)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.composer').dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
  })()`)
}

async function switchModel(client, label) {
  await evaluate(client, `document.querySelector('.model-menu-trigger')?.click()`)
  await waitForEval(client, `Boolean(document.querySelector('.model-options-menu'))`)
  await evaluate(client, `document.querySelector('button[aria-label="Select Model"]')?.click()`)
  await waitForEval(client, `Boolean(document.querySelector('.model-submenu'))`)
  await evaluate(client, `document.querySelector(${JSON.stringify(`button[aria-label="Select ${label}"]`)})?.click()`)
  await waitForEval(
    client,
    `document.querySelector('.model-menu-trigger')?.getAttribute('aria-label')?.includes(${JSON.stringify(label)})`,
  )
}

async function newConversation(client) {
  await evaluate(client, `document.querySelector('button[aria-label="新建会话"]')?.click()`)
  await waitForEval(client, `Boolean(document.querySelector('.empty-state'))`)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const { chrome } = await launchChrome({
    url: 'about:blank',
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-vision-cdp-',
    windowSize: '1280,900',
  })
  let client
  const screenshots = []
  const assertions = {}

  try {
    const target = await getPageTarget(DEBUG_PORT, 'about:blank')
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript })
    await client.send('Page.navigate', { url: APP_URL })
    await waitForEval(client, `Boolean(document.querySelector('.composer textarea'))`)

    await uploadImage(client, 'ready.png')
    await waitForEval(client, `document.querySelector('[data-upload-status="ready"]')?.innerText.includes('ready.png')`)
    screenshots.push(await screenshot(client, OUT_DIR, '01-upload-ready', CAPTURE_SCREENSHOTS))
    assertions.uploadReady = await evaluate(client, `(() => ({
      status: document.querySelector('[data-upload-status]')?.getAttribute('data-upload-status'),
      sendEnabled: !document.querySelector('button[aria-label="发送消息"]')?.disabled,
      model: document.querySelector('.model-menu-trigger')?.textContent,
    }))()`)
    assert(assertions.uploadReady.status === 'ready', 'image did not reach ready state')
    assert(assertions.uploadReady.sendEnabled, 'image-only message should be sendable')
    assert(assertions.uploadReady.model.includes('Vision'), 'Vision model was not active')

    await submit(client, '描述这张图片')
    await waitForEval(client, `document.body.innerText.includes('MOCK_VISION_ANSWER_1')`)
    await waitForEval(client, `Boolean(document.querySelector('button[aria-label="预览图片 ready.png"]'))`)
    await waitForEval(client, `Boolean(document.querySelector('.message-row.user img[alt="ready.png"]'))`)
    screenshots.push(await screenshot(client, OUT_DIR, '02-completed-image-message', CAPTURE_SCREENSHOTS))
    assertions.completed = await evaluate(client, `(() => {
      const state = window.__visionState();
      const ask = state.requests.find((request) => request.pathname.endsWith('/ask'));
      const user = document.querySelector('.message-row.user');
      return {
        attachmentIds: ask?.body?.attachmentIds,
        imageVisible: Boolean(user?.querySelector('img[alt="ready.png"]')),
        reasoningVisible: Boolean(document.querySelector('.reasoning-panel')),
        generationVisible: document.body.innerText.includes('18'),
      };
    })()`)
    assert(assertions.completed.attachmentIds?.length === 1, 'ask request did not carry one attachment id')
    assert(assertions.completed.imageVisible, 'persisted user image is not visible')
    assert(assertions.completed.reasoningVisible, 'Vision reasoning panel is missing')

    await evaluate(client, `document.querySelector('button[aria-label="预览图片 ready.png"]')?.click()`)
    await waitForEval(client, `Boolean(document.querySelector('[role="dialog"] img[alt="ready.png"]'))`)
    screenshots.push(await screenshot(client, OUT_DIR, '03-protected-image-preview', CAPTURE_SCREENSHOTS))
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await waitForEval(client, `!document.querySelector('[role="dialog"]')`)

    const documentIdBeforeReload = await evaluate(client, `window.__visionDocumentId`)
    await client.send('Page.reload')
    await waitForEval(
      client,
      `window.__visionDocumentId && window.__visionDocumentId !== ${JSON.stringify(documentIdBeforeReload)}`,
    )
    await waitForEval(client, `Boolean(document.querySelector('img[alt="ready.png"]'))`)
    assertions.refresh = await evaluate(client, `(() => ({
      imageVisible: Boolean(document.querySelector('img[alt="ready.png"]')),
      answerVisible: document.body.innerText.includes('MOCK_VISION_ANSWER_1'),
    }))()`)
    assert(assertions.refresh.imageVisible && assertions.refresh.answerVisible, 'image message did not survive refresh')

    await evaluate(client, `document.querySelector('button[aria-label="重新生成回答"]')?.click()`)
    await waitForEval(client, `document.body.innerText.includes('MOCK_VISION_ANSWER_2')`)
    assertions.branch = await evaluate(client, `(() => {
      const state = window.__visionState();
      const lastAsk = state.requests.filter((request) => request.pathname.endsWith('/ask')).at(-1);
      return {
        branchCount: state.branchCount,
        attachmentIds: lastAsk?.body?.attachmentIds,
        parentMessages: state.conversations.find((item) => item.id === 'vision-conversation-1')?.messages.length,
      };
    })()`)
    assert(assertions.branch.branchCount === 1, 'regeneration did not create a branch')
    assert(assertions.branch.attachmentIds?.length === 1, 'branch did not submit copied attachment')
    assert(assertions.branch.parentMessages === 2, 'branch mutated the parent conversation')

    await newConversation(client)
    await uploadImage(client, 'retry.png')
    await waitForEval(client, `document.querySelector('[data-upload-status="error"]')?.innerText.includes('Mock 图片上传失败')`)
    screenshots.push(await screenshot(client, OUT_DIR, '04-upload-error', CAPTURE_SCREENSHOTS))
    await evaluate(client, `document.querySelector('button[aria-label="重试上传 retry.png"]')?.click()`)
    await waitForEval(client, `document.querySelector('[data-upload-status="ready"]')?.innerText.includes('retry.png')`)
    assertions.retry = await evaluate(client, `window.__visionState().uploadAttempts['retry.png']`)
    assert(assertions.retry === 2, 'failed upload was not retried exactly once')

    await switchModel(client, 'DeepSeek V4 Pro')
    await waitForEval(client, `document.body.innerText.includes('当前模型不支持图片')`)
    screenshots.push(await screenshot(client, OUT_DIR, '05-text-model-blocked', CAPTURE_SCREENSHOTS))
    assertions.unsupported = await evaluate(client, `({
      warning: document.body.innerText.includes('当前模型不支持图片'),
      sendDisabled: document.querySelector('button[aria-label="发送消息"]')?.disabled,
    })`)
    assert(assertions.unsupported.warning && assertions.unsupported.sendDisabled, 'text model did not block image submission')
    await switchModel(client, 'DeepSeek V4 Flash Vision Exp')
    await submit(client, '')
    await waitForEval(client, `document.body.innerText.includes('MOCK_VISION_ANSWER_3')`)

    await newConversation(client)
    await uploadImage(client, 'slow.png')
    await waitForEval(client, `document.querySelector('[data-upload-status="ready"]')?.innerText.includes('slow.png')`)
    await evaluate(client, `window.__visionSetSlowAsk()`)
    await submit(client, '停止图片回答')
    await waitForEval(client, `document.body.innerText.includes('MOCK_VISION_PARTIAL') && Boolean(document.querySelector('button[aria-label="停止生成"]'))`)
    screenshots.push(await screenshot(client, OUT_DIR, '06-image-stream-before-stop', CAPTURE_SCREENSHOTS))
    await evaluate(client, `document.querySelector('button[aria-label="停止生成"]')?.click()`)
    await waitForEval(client, `document.body.innerText.includes('已停止生成') && !document.querySelector('button[aria-label="停止生成"]')`)
    screenshots.push(await screenshot(client, OUT_DIR, '07-image-stream-stopped', CAPTURE_SCREENSHOTS))
    assertions.stop = await evaluate(client, `(() => {
      const state = window.__visionState();
      const current = state.conversations[0];
      return {
        stopped: current.messages.at(-1)?.status,
        imageCount: current.messages.at(-2)?.attachments?.length,
        partialVisible: document.body.innerText.includes('MOCK_VISION_PARTIAL'),
      };
    })()`)
    assert(assertions.stop.stopped === 'stopped', 'stopped Vision answer was not persisted as stopped')
    assert(assertions.stop.imageCount === 1, 'stopped Vision user message lost its attachment')
    assert(assertions.stop.partialVisible, 'stopped partial answer is not visible')

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 820,
      deviceScaleFactor: 1,
      mobile: true,
    })
    screenshots.push(await screenshot(client, OUT_DIR, '08-mobile-image-message', CAPTURE_SCREENSHOTS))
    assertions.mobile = await evaluate(client, `(() => {
      const grid = document.querySelector('.message-attachment-grid');
      const userRow = document.querySelector('.message-row.user');
      const composer = document.querySelector('.composer-inner');
      const main = document.querySelector('.chat-main');
      const rect = (element) => {
        const value = element?.getBoundingClientRect();
        return value ? { left: value.left, right: value.right, width: value.width } : null;
      };
      return {
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
        grid: rect(grid),
        userRow: rect(userRow),
        composer: rect(composer),
        main: rect(main),
        viewportWidth: window.innerWidth,
      };
    })()`)
    assert(!assertions.mobile.pageOverflow, 'mobile image message caused page horizontal overflow')
    for (const [name, rect] of Object.entries({
      grid: assertions.mobile.grid,
      userRow: assertions.mobile.userRow,
      composer: assertions.mobile.composer,
    })) {
      assert(rect, `mobile ${name} bounds are unavailable`)
      assert(rect.left >= 0, `mobile ${name} is clipped on the left`)
      assert(rect.right <= assertions.mobile.viewportWidth, `mobile ${name} is clipped on the right`)
    }
    assert(assertions.mobile.main?.left === 0, 'mobile chat main does not start at the viewport edge')
    assert(assertions.mobile.main?.right <= assertions.mobile.viewportWidth, 'mobile chat main exceeds the viewport')

    console.log(JSON.stringify({
      allPassed: true,
      assertions,
      screenshots: screenshots.filter(Boolean),
    }, null, 2))
  } catch (error) {
    if (client) {
      screenshots.push(await screenshot(client, OUT_DIR, '99-failure', true).catch(() => null))
    }
    throw error
  } finally {
    client?.close()
    await stopProcess(chrome)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
