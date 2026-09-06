#!/usr/bin/env bun

import createApp from '../app.ts'
import { MAX_PORTABLE_BACKUP_BYTES } from '../config/productLimits.ts'
import { getDeploymentConfig, loadTlsServerOptions } from '../config/deploymentConfig.ts'
import { cleanupOrphanedAttachments } from '../services/attachmentService.ts'
import { closeAuthSessionStores } from '../utils/authSessionStore.ts'
import { closeConversationStore } from '../utils/conversationStore.ts'
import { cancelAllRequests } from '../utils/requestRegistry.ts'

const deployment = getDeploymentConfig()
const app = createApp({ clientHosting: deployment.client })
const commonOptions = {
  development: false,
  fetch: app,
  idleTimeout: 0,
  maxRequestBodySize: MAX_PORTABLE_BACKUP_BYTES,
  ...(deployment.https.enabled ? { tls: loadTlsServerOptions(deployment.https) } : {}),
}

let server: BunRuntime.Server
try {
  server = typeof deployment.port === 'string'
    ? Bun.serve({ ...commonOptions, unix: deployment.port })
    : Bun.serve({
        ...commonOptions,
        hostname: deployment.host,
        port: deployment.port,
      })
} catch (error) {
  const listenError = error as NodeJS.ErrnoException
  const bind = typeof deployment.port === 'string'
    ? `Pipe ${deployment.port}`
    : `Port ${deployment.port}`
  if (listenError.code === 'EACCES') {
    console.error(`${bind} requires elevated privileges`)
    process.exit(1)
  }
  if (listenError.code === 'EADDRINUSE') {
    console.error(`${bind} is already in use`)
    process.exit(1)
  }
  throw error
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

const protocol = deployment.https.enabled ? 'https' : 'http'
if (typeof deployment.port === 'string') {
  console.log(`服务器已启动，监听 pipe ${deployment.port}`)
} else {
  const displayHost = deployment.host === '0.0.0.0' ? 'localhost' : deployment.host
  console.log(`服务器已启动：${protocol}://${displayHost}:${server.port}`)
  console.log(`前端构建托管：${deployment.client.enabled ? '已启用' : '未启用'}`)
}

void cleanupOrphanedAttachments().then((deleted) => {
  if (deleted > 0) console.log(`已清理 ${deleted} 个过期孤儿附件`)
}).catch((error) => {
  console.warn('附件孤儿清理失败：', error)
})

let shuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`收到 ${signal}，正在停止服务`)
  const cancelledRequests = cancelAllRequests('server_shutdown')
  if (cancelledRequests > 0) console.log(`已取消 ${cancelledRequests} 个活动请求`)

  let forced = false
  let forceTimer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    forceTimer = setTimeout(() => {
      forced = true
      console.error('服务未能在 10 秒内停止，强制关闭连接')
      void server.stop(true).finally(resolve)
    }, 10_000)
    forceTimer.unref()
  })

  try {
    await Promise.race([server.stop(false), timeout])
    if (forceTimer) clearTimeout(forceTimer)
    closeConversationStore()
    closeAuthSessionStores()
    console.log('服务已停止')
    process.exit(forced ? 1 : 0)
  } catch (error) {
    if (forceTimer) clearTimeout(forceTimer)
    console.error('停止服务失败：', error)
    process.exit(1)
  }
}
