import type { BunHttpHandler } from '../../../bun-server/app.ts'

type BunTestServer = {
  origin: string
  close: () => Promise<void>
}

function startBunTestServer(app: BunHttpHandler): BunTestServer {
  const server = Bun.serve({
    development: false,
    fetch: app,
    hostname: '127.0.0.1',
    idleTimeout: 0,
    port: 0,
  })

  return {
    origin: `http://127.0.0.1:${server.port}`,
    close: () => server.stop(true),
  }
}

export { startBunTestServer }
export type { BunTestServer }
