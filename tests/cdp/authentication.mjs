import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { delay, stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const DEBUG_PORT = Number(process.env.CDP_AUTH_PORT || 9346)
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-authentication')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitFor(client, expression, timeoutMs = 8000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(client, expression)) return
    await delay(80)
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}

async function submitLogin(client, username, password) {
  await evaluate(client, `(() => {
    const username = document.querySelector('#auth-username');
    const password = document.querySelector('#auth-password');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(username, ${JSON.stringify(username)});
    username.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(password, ${JSON.stringify(password)});
    password.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form[aria-label="登录"]')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`)
}

const mockScript = `
(() => {
  const originalFetch = window.fetch.bind(window);
  let authenticated = false;
  let accessVersion = 0;
  let forceProtected401 = false;
  let conversation = null;
  const requests = [];

  function json(payload, status = 200, headers = {}) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  function issueToken() {
    accessVersion += 1;
    return {
      accessToken: 'cdp-access-token-' + accessVersion,
      expiresAt: Date.now() + 120000,
    };
  }

  function runtime() {
    return {
      runtime: {
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        storageBackend: 'file',
        endpointConfigured: true,
        apiKeyConfigured: true,
        providers: [{
          id: 'deepseek',
          label: 'DeepSeek',
          configured: true,
          endpointConfigured: true,
          apiKeyConfigured: true,
          defaultModel: 'deepseek-v4-flash',
          models: [{
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
          }],
        }],
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          reasoningEnabled: true,
          reasoningEffort: 'medium',
        },
      },
    };
  }

  window.__authCdpState = () => ({
    accessVersion,
    authenticated,
    requests: requests.slice(),
  });
  window.__forceProtected401 = () => { forceProtected401 = true; };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const parsed = new URL(url, window.location.origin);
    const pathname = parsed.pathname.replace(/^\\/api/, '');
    const method = (init.method || 'GET').toUpperCase();
    const authorization = new Headers(init.headers).get('Authorization');
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body || null; }
    requests.push({ authorization, body, method, pathname });

    if (pathname === '/auth/status' && method === 'GET') {
      return json({ enabled: true });
    }
    if (pathname === '/auth/refresh' && method === 'POST') {
      return authenticated
        ? json(issueToken())
        : json({ code: 'refresh_required', message: '登录状态已失效' }, 401);
    }
    if (pathname === '/auth/login' && method === 'POST') {
      if (body?.username === 'limited') {
        return json(
          { code: 'rate_limited', message: '登录尝试过多，请稍后重试' },
          429,
          { 'Retry-After': '30' },
        );
      }
      if (body?.username !== 'tester' || body?.password !== 'correct-password') {
        return json({ code: 'invalid_credentials', message: '用户名或密码错误' }, 401);
      }
      authenticated = true;
      return json(issueToken());
    }
    if (pathname === '/auth/logout' && method === 'POST') {
      authenticated = false;
      return new Response(null, { status: 204 });
    }

    if (pathname === '/runtime-config' || pathname.startsWith('/conversations')) {
      if (forceProtected401) {
        forceProtected401 = false;
        return json({ code: 'token_expired', message: '认证已过期' }, 401);
      }
      if (authorization !== 'Bearer cdp-access-token-' + accessVersion) {
        return json({ code: 'auth_required', message: '需要登录' }, 401);
      }
      if (pathname === '/runtime-config') return json(runtime());
      if (pathname === '/conversations/search') return json({ conversations: [] });
      if (pathname === '/conversations' && method === 'GET') {
        return json({ conversations: conversation ? [{
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          messageCount: conversation.messages.length,
        }] : [] });
      }
      if (pathname === '/conversations' && method === 'POST') {
        const timestamp = new Date().toISOString();
        conversation = {
          id: 'auth-cdp-conversation',
          title: '新的聊天',
          createdAt: timestamp,
          updatedAt: timestamp,
          messages: [],
        };
        return json({ conversation }, 201);
      }
      if (pathname === '/conversations/auth-cdp-conversation' && method === 'GET') {
        return json({ conversation });
      }
    }

    return originalFetch(input, init);
  };
})();
`

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const { chrome } = await launchChrome({
    url: 'about:blank',
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-auth-cdp-',
    windowSize: '1280,900',
  })
  let client

  try {
    const target = await getPageTarget(DEBUG_PORT, 'about:blank')
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript })
    await client.send('Page.navigate', { url: APP_URL })

    await waitFor(client, `Boolean(document.querySelector('form[aria-label="登录"]'))`)
    let state = await evaluate(client, 'window.__authCdpState()')
    assert(
      !state.requests.some((request) => request.pathname === '/runtime-config' || request.pathname === '/conversations'),
      'protected APIs must not load before authentication',
    )

    await submitLogin(client, 'limited', 'wrong')
    await waitFor(client, `document.querySelector('[role="alert"]')?.textContent.includes('30 秒后可重试')`)

    await submitLogin(client, 'tester', 'correct-password')
    await waitFor(client, `Boolean(document.querySelector('textarea'))`)
    state = await evaluate(client, 'window.__authCdpState()')
    const protectedRequests = state.requests.filter(
      (request) => request.pathname === '/runtime-config' || request.pathname === '/conversations',
    )
    assert(protectedRequests.length >= 2, 'authenticated app should load protected runtime and conversation APIs')
    assert(
      protectedRequests.every((request) => request.authorization === 'Bearer cdp-access-token-1'),
      'protected startup requests should carry the in-memory bearer token',
    )

    const storageEvidence = await evaluate(client, `({
      html: document.documentElement.innerHTML.includes('cdp-access-token-'),
      local: Object.values(localStorage).some((value) => value.includes('cdp-access-token-')),
      session: Object.values(sessionStorage).some((value) => value.includes('cdp-access-token-')),
    })`)
    assert(!storageEvidence.html && !storageEvidence.local && !storageEvidence.session, 'access token leaked into DOM or Web Storage')

    await evaluate(client, `window.__forceProtected401()`)
    await evaluate(client, `(() => {
      const input = document.querySelector('.conversation-search-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'refresh-once');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await waitFor(client, `window.__authCdpState().requests.filter(
      (request) => request.pathname === '/conversations/search'
    ).length === 2`)
    state = await evaluate(client, 'window.__authCdpState()')
    const searchRequests = state.requests.filter((request) => request.pathname === '/conversations/search')
    const refreshRequests = state.requests.filter((request) => request.pathname === '/auth/refresh')
    assert(searchRequests[0].authorization === 'Bearer cdp-access-token-1', 'first search should use the original token')
    assert(searchRequests[1].authorization === 'Bearer cdp-access-token-2', '401 replay should use one refreshed token')
    assert(refreshRequests.length === 2, 'startup recovery plus one 401 should make exactly two refresh attempts')

    await evaluate(client, `document.querySelector('.user-menu-trigger').click()`)
    await waitFor(client, `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '退出登录')`)
    await evaluate(client, `[
      ...document.querySelectorAll('button')
    ].find((button) => button.textContent.trim() === '退出登录').click()`)
    await waitFor(client, `Boolean(document.querySelector('form[aria-label="登录"]'))`)
    state = await evaluate(client, 'window.__authCdpState()')
    assert(state.authenticated === false, 'logout should revoke the mock browser session')
    assert(state.requests.filter((request) => request.pathname === '/auth/logout').length === 1, 'logout should submit once')

    console.log(JSON.stringify({
      group: 'authentication',
      assertions: {
        accessTokenMemoryOnly: true,
        logout: true,
        noProtectedPreload: true,
        rateLimitFeedback: true,
        refreshReplayOnce: true,
      },
    }, null, 2))
  } finally {
    client?.close()
    await stopProcess(chrome)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
