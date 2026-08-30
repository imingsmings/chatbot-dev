import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { screenshot, waitForEval } from './helpers/appActions.mjs'
import { delay, stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const DEBUG_PORT = Number(process.env.CDP_ROADMAP_PORT || 9345)
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-roadmap-screenshots')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const mockScript = `
(() => {
  const encoder = new TextEncoder();
  const initialConversation = {
    id: 'conv_roadmap_main',
    title: 'Roadmap 功能回归',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    titleManuallyEdited: true,
    messages: [
      { role: 'user', content: '请记住项目目标' },
      { role: 'assistant', content: '目标是完成 roadmap 并验证。' }
    ]
  };
  const conversations = new Map([[initialConversation.id, initialConversation]]);
  const state = {
    askRequests: [],
    importRequests: [],
    summaryRequests: []
  };

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

  function event(value) {
    return encoder.encode(JSON.stringify(value) + '\\n');
  }

  window.__roadmapState = () => ({
    askRequests: structuredClone(state.askRequests),
    importRequests: structuredClone(state.importRequests),
    summaryRequests: structuredClone(state.summaryRequests),
    conversations: [...conversations.values()].map((conversation) => structuredClone(conversation))
  });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const parsedUrl = new URL(url, location.origin);
    const pathname = parsedUrl.pathname.replace(/^\\/api/, '');
    const method = (init.method || 'GET').toUpperCase();

    if (pathname === '/auth/status' && method === 'GET') return json({ enabled: false });

    if (pathname === '/runtime-config' && method === 'GET') {
      return json({
        runtime: {
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          storageBackend: 'sqlite',
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
                    maxOutputTokens: 65536
                  }
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
                    maxOutputTokens: 65536
                  }
                }
              ]
            },
            {
              id: 'openai',
              label: 'OpenAI',
              configured: true,
              endpointConfigured: true,
              apiKeyConfigured: true,
              defaultModel: 'gpt-5.6-luna',
              models: [{
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
                  maxOutputTokens: 128000
                }
              }, {
                provider: 'openai',
                id: 'gpt-5.6-luna',
                label: 'GPT-5.6 Luna',
                capabilities: {
                  tools: true,
                  reasoning: true,
                  reasoningSummary: true,
                  reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
                  temperature: false,
                  maxOutputTokens: 128000
                }
              }]
            }
          ],
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            reasoningEnabled: true,
            reasoningEffort: 'high'
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
      return json({ message: 'not used' }, 500);
    }

    if (pathname === '/conversations/import' && method === 'POST') {
      const body = JSON.parse(init.body || '{}');
      state.importRequests.push(body);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const imported = body.backup?.conversations?.[0];
      if (imported) conversations.set(imported.id, structuredClone(imported));
      return json({
        result: {
          total: imported ? 1 : 0,
          created: imported ? 1 : 0,
          duplicated: 0,
          overwritten: 0,
          skipped: 0,
          items: imported
            ? [{ sourceId: imported.id, conversationId: imported.id, status: 'created' }]
            : []
        }
      }, 201);
    }

    const summaryMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/summary$/);
    if (summaryMatch && method === 'POST') {
      const id = decodeURIComponent(summaryMatch[1]);
      const conversation = conversations.get(id);
      if (!conversation) return json({ message: 'not found' }, 404);
      const body = JSON.parse(init.body || '{}');
      state.summaryRequests.push(body);
      conversation.summary = {
        content: '用户要完成个人聊天项目 roadmap，并要求所有测试通过。',
        sourceMessageCount: conversation.messages.length,
        updatedAt: '2026-07-31T08:00:00.000Z'
      };
      return json({ conversation });
    }

    const askMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/ask$/);
    if (askMatch && method === 'POST') {
      const id = decodeURIComponent(askMatch[1]);
      const conversation = conversations.get(id);
      if (!conversation) return json({ message: 'not found' }, 404);
      const body = JSON.parse(init.body || '{}');
      state.askRequests.push(body);

      if (body.question === 'ROADMAP_TOOL_STOP') {
        let toolTimer;
        const stream = new ReadableStream({
          start(controller) {
            toolTimer = setTimeout(() => {
              controller.enqueue(event({
                type: 'tool_start',
                toolCallId: 'call_stopped_tool',
                name: 'getWeather'
              }));
            }, 100);

            init.signal?.addEventListener('abort', () => {
              clearTimeout(toolTimer);
              controller.error(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
          },
          cancel() {
            clearTimeout(toolTimer);
          }
        });

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'X-Chat-Stream-Protocol': '2'
          }
        });
      }

      const codeLines = Array.from({ length: 1500 }, (_, index) =>
        'const roadmapLine' + index + ' = ' + index
      ).join('\\n');
      const finalMarkdown = [
        '## LONG-STREAM',
        '',
        '[安全链接](https://example.com/roadmap)',
        '',
        '~~~ts',
        codeLines,
        '~~~',
        '',
        '| 项目 | 状态 |',
        '| --- | --- |',
        '| roadmap | complete |'
      ].join('\\n');
      const chunks = [
        finalMarkdown.slice(0, 12000),
        finalMarkdown.slice(12000, 26000),
        finalMarkdown.slice(26000)
      ];

      const stream = new ReadableStream({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(event({
              type: 'tool_start',
              toolCallId: 'call_calc_roadmap',
              name: 'calculate'
            }));
          }, 100);

          setTimeout(() => {
            controller.enqueue(event({
              type: 'tool_result',
              toolCallId: 'call_calc_roadmap',
              name: 'calculate',
              summary: '计算结果：42',
              success: true
            }));
          }, 650);

          chunks.forEach((chunk, index) => {
            setTimeout(() => {
              controller.enqueue(event({ type: 'delta', content: chunk }));
            }, 850 + index * 380);
          });

          setTimeout(() => {
            conversation.messages.push(
              { role: 'user', content: body.question || '' },
              {
                role: 'assistant',
                content: finalMarkdown,
                status: 'completed',
                toolTrace: [{
                  name: 'calculate',
                  success: true,
                  durationMs: 550,
                  summary: '计算结果：42'
                }]
              }
            );
            conversation.updatedAt = new Date().toISOString();
            controller.enqueue(event({ type: 'done' }));
            controller.close();
          }, 2200);
        }
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'X-Chat-Stream-Protocol': '2'
        }
      });
    }

    const modelOptionsMatch = pathname.match(/^\\/conversations\\/([^/]+)\\/model-options$/);
    if (modelOptionsMatch && method === 'PATCH') {
      const conversation = conversations.get(decodeURIComponent(modelOptionsMatch[1]));
      if (!conversation) return json({ message: 'not found' }, 404);
      const body = JSON.parse(init.body || '{}');
      conversation.modelOptions = structuredClone(body.options);
      return json({ conversation });
    }

    const detailMatch = pathname.match(/^\\/conversations\\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const conversation = conversations.get(decodeURIComponent(detailMatch[1]));
      return conversation ? json({ conversation }) : json({ message: 'not found' }, 404);
    }

    if (pathname.startsWith('/requests/') && pathname.endsWith('/cancel') && method === 'POST') {
      return json({ cancelled: true });
    }

    return json({ message: 'unexpected route: ' + method + ' ' + pathname }, 500);
  };
})();
`

async function clickButton(client, text) {
  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) =>
        item.textContent.trim() === ${JSON.stringify(text)} ||
        item.getAttribute('aria-label') === ${JSON.stringify(text)}
      );
    if (!button) throw new Error('button not found: ${text}');
    button.click();
  })()`)
}

async function clickAppAction(client, text) {
  const clickedDirectly = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === ${JSON.stringify(text)});
    if (!button) return false;
    button.click();
    return true;
  })()`)
  if (clickedDirectly) return

  await clickButton(client, '更多操作')
  await waitForEval(
    client,
    `[...document.querySelectorAll('.app-actions-menu button')]
      .some((item) => item.textContent.trim() === ${JSON.stringify(text)})`,
  )
  await clickButton(client, text)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const { chrome } = await launchChrome({
    url: 'about:blank',
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-roadmap-',
    windowSize: '1280,900'
  })
  let client
  const screenshots = []
  const assertions = {}

  try {
    const target = await getPageTarget(DEBUG_PORT, 'about:blank')
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Browser.grantPermissions', {
      origin: new URL(APP_URL).origin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
    }).catch(() => {})
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript })
    await client.send('Page.navigate', { url: APP_URL })
    await waitForEval(client, `document.body.innerText.includes('Roadmap 功能回归')`)

    assertions.modelSwitch = await evaluate(client, `(() => ({
      available: Boolean(document.querySelector('.model-menu-trigger')),
      selected: !document.querySelector('.model-menu-trigger')
    }))()`)
    if (assertions.modelSwitch.available) {
      await clickButton(client, 'Model and Effort: DeepSeek V4 Flash, High')
      await waitForEval(client, `Boolean(document.querySelector('button[aria-label="Select Model"]'))`)
      await clickButton(client, 'Select Model')
      await waitForEval(client, `Boolean(document.querySelector('button[aria-label="Select GPT-5.6 Luna"]'))`)
      assertions.disabledModels = await evaluate(client, `(() => {
        const buttons = [...document.querySelectorAll('.model-submenu button')];
        const headings = [...document.querySelectorAll('.model-submenu .submenu-heading')];
        const groups = [...document.querySelectorAll('.model-submenu .model-provider-group')];
        const state = (label) => {
          const button = buttons.find((item) => item.textContent.includes(label));
          return Boolean(button &&
            (button.disabled || button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('data-disabled')));
        };
        const option = buttons.find((item) => item.textContent.includes('DeepSeek V4 Flash'));
        const proOption = buttons.find((item) => item.textContent.includes('DeepSeek V4 Pro'));
        const disabledOption = buttons.find((item) => item.textContent.includes('GPT-5.6 Sol'));
        const headingStyle = headings[0] ? getComputedStyle(headings[0]) : null;
        const optionStyle = option ? getComputedStyle(option) : null;
        const disabledStyle = disabledOption ? getComputedStyle(disabledOption) : null;
        return {
          deepseekProEnabled: Boolean(proOption && !state('DeepSeek V4 Pro')),
          openaiSol: state('GPT-5.6 Sol'),
          providerGroups: groups.length === 2,
          providerLabels: headings.map((heading) => heading.textContent.trim()).join('|') === 'DeepSeek|OpenAI',
          providerSeparator: document.querySelectorAll('.model-submenu .model-provider-separator').length === 1,
          headingTypography: headingStyle?.fontSize === '12px' && Number(headingStyle.fontWeight) >= 500,
          optionTypography: optionStyle?.fontSize === '14px',
          optionIndented: Boolean(
            headingStyle && optionStyle &&
            parseFloat(optionStyle.paddingLeft) - parseFloat(headingStyle.paddingLeft) >= 8
          ),
          disabledContrast: Boolean(disabledStyle && parseFloat(disabledStyle.opacity) <= 0.4)
        };
      })()`)
      await clickButton(client, 'Select GPT-5.6 Luna')
      await waitForEval(
        client,
        `document.querySelector('.model-menu-trigger')?.getAttribute('aria-label')
          ?.includes('GPT-5.6 Luna') &&
          document.querySelector('.model-menu-trigger')?.disabled === false`,
      )
      assertions.modelSwitch.selected = true
    }

    const expectedSettingsProvider = assertions.modelSwitch.available ? 'OpenAI' : 'DeepSeek'
    const expectedSettingsModelLabel = assertions.modelSwitch.available
      ? 'GPT-5.6 Luna'
      : 'DeepSeek V4 Flash'
    const expectedSettingsModelId = assertions.modelSwitch.available
      ? 'gpt-5.6-luna'
      : 'deepseek-v4-flash'
    await clickAppAction(client, '参数')
    await waitForEval(client, `Boolean(document.querySelector('.settings-modal'))`)
    assertions.runtime = await evaluate(client, `(() => {
      const text = document.querySelector('.settings-modal').innerText;
      return {
        provider: text.includes(${JSON.stringify(expectedSettingsProvider)}),
        model: text.includes(${JSON.stringify(expectedSettingsModelLabel)}),
        storage: text.includes('SQLite')
      };
    })()`)
    await evaluate(client, `(() => {
      const fields = [...document.querySelectorAll('.settings-field')];
      const setValue = (label, value) => {
        const field = fields.find((item) => item.querySelector('span')?.textContent.trim() === label);
        const input = field?.querySelector('input, select');
        if (!input) throw new Error('settings field not found: ' + label);
        const prototype = input instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue('Max Tokens', '2048');
      setValue(${JSON.stringify(`${expectedSettingsProvider} Effort`)}, 'high');
    })()`)
    await clickButton(client, 'Apply')
    await waitForEval(client, `document.querySelector('.model-menu-trigger')?.disabled === false`)

    await clickAppAction(client, '模板')
    await waitForEval(client, `Boolean(document.querySelector('.template-modal'))`)
    await clickButton(client, '学习计划')
    await evaluate(client, `(() => {
      const values = {
        '主题': '流式渲染',
        '当前基础': 'React 19',
        '可用时间': '每周 5 小时',
        '目标': '掌握 NDJSON'
      };
      for (const field of document.querySelectorAll('.template-fields .settings-field')) {
        const label = field.querySelector('span')?.textContent.trim();
        const input = field.querySelector('input, textarea');
        if (input && values[label] !== undefined) {
          const prototype = input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, values[label]);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    })()`)
    await clickButton(client, '填入输入框')
    assertions.template = await evaluate(client, `document.querySelector('.composer textarea').value.includes('流式渲染') &&
      document.querySelector('.composer textarea').value.includes('掌握 NDJSON')`)

    await clickAppAction(client, '摘要')
    await clickButton(client, '生成摘要')
    await waitForEval(client, `document.querySelector('.summary-content')?.innerText.includes('roadmap')`)
    assertions.summary = await evaluate(client, `(() => {
      const state = window.__roadmapState();
      return {
        visible: document.querySelector('.summary-content').innerText.includes('所有测试通过'),
        requestCount: state.summaryRequests.length,
        options: state.summaryRequests[0]?.options
      };
    })()`)
    const summaryShot = await screenshot(client, OUT_DIR, '01-summary', CAPTURE_SCREENSHOTS)
    if (summaryShot) screenshots.push(summaryShot)
    await clickButton(client, '关闭')

    await evaluate(client, `(() => {
      const input = document.querySelector('.composer textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        .set.call(input, 'ROADMAP_TOOL_STREAM');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.composer').dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }));
    })()`)

    await waitForEval(client, `Boolean(document.querySelector('.tool-activity.running'))`)
    assertions.toolRunning = await evaluate(client, `document.querySelector('.tool-activity.running')?.innerText.includes('calculate')`)
    const toolShot = await screenshot(client, OUT_DIR, '02-tool-running', CAPTURE_SCREENSHOTS)
    if (toolShot) screenshots.push(toolShot)

    await waitForEval(
      client,
      `document.querySelector('.markdown-message[data-render-mode="streaming-lite"]')?.innerText.includes('LONG-STREAM')`,
      10000
    )
    assertions.streamingMid = await evaluate(client, `(() => {
      const markdown = document.querySelector('.markdown-message[data-render-mode="streaming-lite"]');
      return {
        mode: markdown?.dataset.renderMode,
        generating: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止'),
        codePresent: Boolean(markdown?.querySelector('code'))
      };
    })()`)
    const streamShot = await screenshot(client, OUT_DIR, '03-long-streaming-mid', CAPTURE_SCREENSHOTS)
    if (streamShot) screenshots.push(streamShot)

    try {
      await waitForEval(
        client,
        `[...document.querySelectorAll('.message-row.assistant')]
          .some((row) => row.innerText.includes('LONG-STREAM') &&
            row.querySelector('.markdown-message[data-render-mode="complete"]')?.innerText.includes('roadmapLine1499')) &&
          ![...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`,
        20000
      )
    } catch (err) {
      const diagnostic = await evaluate(client, `(() => {
        const markdown = document.querySelector('.markdown-message');
        const assistant = [...document.querySelectorAll('.message-row.assistant')].at(-1);
        return {
          bodyError: document.body.innerText.includes('响应失败') || document.body.innerText.includes('响应中断'),
          bodyTail: document.body.innerText.slice(-500),
          markdownMode: markdown?.dataset.renderMode,
          markdownLength: markdown?.innerText.length || 0,
          assistantTextLength: assistant?.innerText.length || 0,
          hasLastLine: assistant?.innerText.includes('roadmapLine1499'),
          hasStop: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止'),
          requestCount: window.__roadmapState().askRequests.length
        };
      })()`)
      console.error('Roadmap completion diagnostic:', JSON.stringify(diagnostic, null, 2))
      throw err
    }
    assertions.completed = await evaluate(client, `(() => {
      const row = [...document.querySelectorAll('.message-row.assistant')]
        .find((item) => item.innerText.includes('LONG-STREAM'));
      const link = row.querySelector('a');
      const code = row.querySelector('pre code');
      const state = window.__roadmapState();
      return {
        toolSuccess: Boolean(row.querySelector('.tool-activity.success')),
        codeLanguage: row.querySelector('.code-language')?.textContent,
        codeLength: code?.textContent.length || 0,
        copyButton: Boolean(row.querySelector('[data-code-copy]')),
        linkTarget: link?.getAttribute('target'),
        linkRel: link?.getAttribute('rel'),
        table: Boolean(row.querySelector('table')),
        noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        askOptions: state.askRequests[0]?.options
      };
    })()`)

    await client.send('Page.bringToFront').catch(() => {})
    await evaluate(client, `(() => {
      const row = [...document.querySelectorAll('.message-row.assistant')]
        .find((item) => item.innerText.includes('LONG-STREAM'));
      const button = row.querySelector('[data-code-copy]');
      button.click();
    })()`)
    await waitForEval(client, `[...document.querySelectorAll('[data-code-copy]')].some((button) => button.textContent === '已复制')`)
    assertions.codeCopy = await evaluate(client, `navigator.clipboard.readText().then((text) =>
      text.includes('roadmapLine1499') && !text.includes('<span'))`)

    await evaluate(client, `(() => {
      const input = document.querySelector('.composer textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        .set.call(input, 'ROADMAP_TOOL_STOP');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.composer').dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }));
    })()`)
    await waitForEval(client, `document.querySelector('.tool-activity.running')?.innerText.includes('getWeather')`)
    await clickButton(client, '停止')
    await waitForEval(
      client,
      `document.querySelector('.tool-activity.stopped')?.innerText.includes('已停止') &&
        ![...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '停止')`
    )
    assertions.toolStopped = await evaluate(client, `(() => ({
      stopped: Boolean(document.querySelector('.tool-activity.stopped')),
      running: Boolean(document.querySelector('.tool-activity.running')),
      messageStopped: [...document.querySelectorAll('.message-status-text')]
        .some((item) => item.textContent.includes('已停止生成'))
    }))()`)

    const importBackup = {
      schemaVersion: 1,
      source: 'chatbot-local',
      exportedAt: '2026-07-31T09:00:00.000Z',
      conversations: [{
        id: 'conv_roadmap_imported',
        title: '导入的 Roadmap 会话',
        createdAt: '2026-07-31T09:00:00.000Z',
        updatedAt: '2026-07-31T09:00:00.000Z',
        titleManuallyEdited: true,
        messages: [{ role: 'user', content: 'imported' }]
      }]
    }
    await evaluate(client, `(() => {
      const input = document.querySelector('input[type="file"][accept*=".json"]');
      const transfer = new DataTransfer();
      transfer.items.add(new File(
        [${JSON.stringify(JSON.stringify(importBackup))}],
        'roadmap-backup.json',
        { type: 'application/json' }
      ));
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
      for (let index = 0; index < 3; index += 1) {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`)
    await waitForEval(
      client,
      `(() => {
        const userTrigger = document.querySelector('.user-menu-trigger');
        const importButton = document.querySelector('button[aria-label="导入 JSON/ZIP"]');
        const loading = (userTrigger?.getAttribute('aria-label') === '导入中...' &&
          userTrigger.getAttribute('aria-busy') === 'true') ||
          (importButton?.disabled === true && importButton.getAttribute('aria-busy') === 'true');
        return loading &&
          window.__roadmapState().importRequests.length === 1;
      })()`
    )
    await waitForEval(client, `document.querySelector('.modal-header')?.innerText.includes('导入完成')`)
    assertions.import = await evaluate(client, `(() => {
      const state = window.__roadmapState();
      return {
        resultVisible: document.querySelector('.modal-content').innerText.includes('新增：1'),
        strategy: state.importRequests[0]?.conflictStrategy,
        listed: document.body.innerText.includes('导入的 Roadmap 会话'),
        requestCount: state.importRequests.length,
        loadingVisible: document.querySelector('.user-menu-trigger')
          ?.getAttribute('aria-label') === '导入中...' ||
          document.querySelector('button[aria-label="导入 JSON/ZIP"]')?.disabled === true
      };
    })()`)
    await clickButton(client, '知道了')
    await waitForEval(
      client,
      `(() => {
        const userTrigger = document.querySelector('.user-menu-trigger');
        const importButton = document.querySelector('button[aria-label="导入 JSON/ZIP"]');
        return (userTrigger?.getAttribute('aria-label') === '用户设置' &&
          !userTrigger.matches(':disabled, [data-disabled], [aria-disabled="true"]')) ||
          importButton?.disabled === false;
      })()`
    )

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    })
    await delay(250)
    assertions.mobile = await evaluate(client, `(() => {
      const tools = document.querySelector('.composer-tools');
      const composer = document.querySelector('.composer-inner');
      return {
        noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        toolsFitComposer: tools.getBoundingClientRect().width <= composer.getBoundingClientRect().width,
        textareaVisible: document.querySelector('.composer textarea').getBoundingClientRect().height > 0
      };
    })()`)
    const mobileShot = await screenshot(client, OUT_DIR, '04-mobile', CAPTURE_SCREENSHOTS)
    if (mobileShot) screenshots.push(mobileShot)

    assert(Object.values(assertions.runtime).every(Boolean), 'runtime information was not fully displayed')
    assert(assertions.modelSwitch.selected, 'OpenAI model selection failed')
    assert(Object.values(assertions.disabledModels || {}).every(Boolean), 'disabled model state missing')
    assert(assertions.template, 'prompt template variables were not applied')
    assert(assertions.summary.visible && assertions.summary.requestCount === 1, 'summary flow failed')
    assert(assertions.summary.options.temperature === undefined, 'OpenAI summary sent unsupported temperature')
    assert(assertions.summary.options.provider === 'openai', 'summary request provider missing')
    assert(
      assertions.summary.options.model === expectedSettingsModelId,
      'summary request model missing',
    )
    assert(assertions.toolRunning, 'tool running status was not rendered')
    assert(assertions.streamingMid.mode === 'streaming-lite' && assertions.streamingMid.generating, 'streaming-lite state missing')
    assert(assertions.completed.toolSuccess, 'tool result status was not rendered')
    assert(assertions.completed.codeLanguage === 'ts' && assertions.completed.codeLength > 30000, 'long code block failed')
    assert(assertions.completed.copyButton && assertions.codeCopy, 'code block copy failed')
    assert(
      assertions.toolStopped.stopped && !assertions.toolStopped.running && assertions.toolStopped.messageStopped,
      'stopped tool UI did not reach a terminal state'
    )
    assert(assertions.completed.linkTarget === '_blank', 'link target policy missing')
    assert(assertions.completed.linkRel.includes('noopener'), 'link rel policy missing')
    assert(assertions.completed.table && assertions.completed.noPageOverflow, 'Markdown layout failed')
    assert(assertions.completed.askOptions.temperature === undefined, 'OpenAI ask sent unsupported temperature')
    assert(assertions.completed.askOptions.provider === 'openai', 'ask request provider missing')
    assert(assertions.completed.askOptions.maxTokens === 2048, 'ask request maxTokens missing')
    assert(assertions.completed.askOptions.reasoningEffort === 'high', 'ask request reasoning effort missing')
    assert(assertions.completed.askOptions.model === expectedSettingsModelId, 'ask request model missing')
    assert(
      assertions.import.resultVisible &&
        assertions.import.strategy === 'skip' &&
        assertions.import.listed &&
        assertions.import.requestCount === 1 &&
        assertions.import.loadingVisible,
      'import UI state or duplicate-click protection failed'
    )
    assert(Object.values(assertions.mobile).every(Boolean), 'mobile layout assertions failed')

    console.log(JSON.stringify({
      ok: true,
      assertions,
      screenshots
    }))
  } finally {
    client?.close()
    await stopProcess(chrome)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
