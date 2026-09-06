declare namespace BunRuntime {
  type FetchHandler = (
    request: Request,
    server: Server,
  ) => Response | Promise<Response>

  type TLSOptions = {
    ca?: string | Buffer | Buffer[]
    cert: string | Buffer
    key: string | Buffer
  }

  type ServeOptions = {
    development?: boolean
    fetch: FetchHandler
    hostname?: string
    idleTimeout?: number
    maxRequestBodySize?: number
    port?: number
    tls?: TLSOptions
    unix?: string
  }

  type SocketAddress = {
    address: string
    family: string
    port: number
  }

  interface Server {
    readonly port: number
    requestIP(request: Request): SocketAddress | null
    stop(closeActiveConnections?: boolean): Promise<void>
  }
}

declare const Bun: {
  file(path: string | URL): Blob
  serve(options: BunRuntime.ServeOptions): BunRuntime.Server
}
