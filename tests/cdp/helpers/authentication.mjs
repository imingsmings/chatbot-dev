import { delay } from './services.mjs'

function authCredentials() {
  const username = process.env.CDP_AUTH_USERNAME || ''
  const password = process.env.CDP_AUTH_PASSWORD || ''
  return username && password ? { password, username } : null
}

function createAuthenticatedFetch(authBaseUrl) {
  const credentials = authCredentials()
  let accessToken = ''

  async function login() {
    if (!credentials) return ''
    const loginUrl = new URL('/api/auth/login', authBaseUrl)
    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: loginUrl.origin,
      },
      body: JSON.stringify(credentials),
    })
    if (!response.ok) {
      throw new Error(`Real-test API login failed (${response.status}): ${await response.text()}`)
    }
    const payload = await response.json()
    if (typeof payload.accessToken !== 'string' || !payload.accessToken) {
      throw new Error('Real-test API login returned no access token')
    }
    accessToken = payload.accessToken
    return accessToken
  }

  return async function authenticatedFetch(input, init = {}) {
    if (!credentials) return fetch(input, init)
    if (!accessToken) await login()

    const send = () => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${accessToken}`)
      return fetch(input, { ...init, headers })
    }
    let response = await send()
    if (response.status !== 401) return response

    await login()
    response = await send()
    return response
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result?.value
}

async function authenticateBrowser(client, timeoutMs = 15_000) {
  const credentials = authCredentials()
  if (!credentials) return

  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evaluate(client, `({
      login: Boolean(document.querySelector('form[aria-label="登录"]')),
      ready: Boolean(document.querySelector('textarea')),
    })`)
    if (state.ready) return
    if (state.login) break
    await delay(100)
  }

  await evaluate(client, `(() => {
    const username = document.querySelector('#auth-username');
    const password = document.querySelector('#auth-password');
    if (!username || !password) throw new Error('Authentication login form did not become ready');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(username, ${JSON.stringify(credentials.username)});
    username.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(password, ${JSON.stringify(credentials.password)});
    password.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form[aria-label="登录"]')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`)

  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(client, `Boolean(document.querySelector('textarea'))`)) return
    const error = await evaluate(client, `document.querySelector('[role="alert"]')?.textContent || ''`)
    if (error) throw new Error(`Browser authentication failed: ${error}`)
    await delay(100)
  }
  throw new Error('Timed out waiting for authenticated chat UI')
}

export { authenticateBrowser, createAuthenticatedFetch }
