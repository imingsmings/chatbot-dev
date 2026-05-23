const DEFAULT_COMMAND_TIMEOUT_MS = Number(process.env.CDP_COMMAND_TIMEOUT_MS || 10000)

class CdpClient {
  constructor(wsUrl, options = {}) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.events = new Map()
    this.commandTimeoutMs = options.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS

    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })

    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data)

      if (!payload.id) {
        const listeners = this.events.get(payload.method)
        listeners?.forEach((listener) => listener(payload.params || {}))
        return
      }

      const pending = this.pending.get(payload.id)
      if (!pending) return
      this.pending.delete(payload.id)

      if (payload.error) {
        pending.reject(new Error(`${payload.error.message}: ${payload.error.data || ''}`))
      } else {
        pending.resolve(payload.result || {})
      }
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const context =
          method === 'Runtime.evaluate' && params.expression
            ? `: ${params.expression.slice(0, 180)}`
            : ''
        reject(new Error(`CDP command timed out: ${method}${context}`))
      }, this.commandTimeoutMs)

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
    })
  }

  on(method, callback) {
    const listeners = this.events.get(method) || []
    listeners.push(callback)
    this.events.set(method, listeners)
  }

  close() {
    this.ws.close()
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })

  if (result.exceptionDetails) {
    const detail =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.exception?.value ||
      result.exceptionDetails.text ||
      'Runtime evaluation failed'
    throw new Error(detail)
  }

  return result.result?.value
}

export {
  CdpClient,
  evaluate,
}
