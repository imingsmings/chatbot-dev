#!/usr/bin/env bun

import debugLib from 'debug'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import createApp from '../app.ts'
import { getDeploymentConfig, loadTlsServerOptions } from '../config/deploymentConfig.ts'
import { closeConversationStore } from '../utils/conversationStore.ts'
import { closeAuthSessionStores } from '../utils/authSessionStore.ts'
import { cancelAllRequests } from '../utils/requestRegistry.ts'
import { cleanupOrphanedAttachments } from '../services/attachmentService.ts'

const debug = debugLib('server:server')
const deployment = getDeploymentConfig()
const app = createApp({ clientHosting: deployment.client })
const server = deployment.https.enabled
  ? https.createServer(loadTlsServerOptions(deployment.https), app)
  : http.createServer(app)

app.set('port', deployment.port)
server.on('error', onError)
server.on('listening', onListening)
process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

if (typeof deployment.port === 'number') {
  server.listen(deployment.port, deployment.host)
} else {
  server.listen(deployment.port)
}

function onError(error: NodeJS.ErrnoException): void {
  if (error.syscall !== 'listen') {
    throw error
  }

  const bind = typeof deployment.port === 'string'
    ? `Pipe ${deployment.port}`
    : `Port ${deployment.port}`

  switch (error.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges`)
      process.exit(1)
    case 'EADDRINUSE':
      console.error(`${bind} is already in use`)
      process.exit(1)
    default:
      throw error
  }
}

function onListening(): void {
  const address = server.address()
  if (!address) {
    throw new Error('服务器已触发 listening 事件，但未返回监听地址')
  }
  const bind = typeof address === 'string'
    ? `pipe ${address}`
    : `port ${(address as AddressInfo).port}`
  const protocol = deployment.https.enabled ? 'https' : 'http'

  debug(`Listening on ${bind}`)
  if (typeof address === 'string') {
    console.log(`服务器已启动，监听 ${bind}`)
    return
  }

  const displayHost = deployment.host === '0.0.0.0' ? 'localhost' : deployment.host
  console.log(`服务器已启动：${protocol}://${displayHost}:${address.port}`)
  console.log(`前端构建托管：${deployment.client.enabled ? '已启用' : '未启用'}`)
  void cleanupOrphanedAttachments().then((deleted) => {
    if (deleted > 0) console.log(`已清理 ${deleted} 个过期孤儿附件`)
  }).catch((error) => {
    console.warn('附件孤儿清理失败：', error)
  })
}

let shuttingDown = false

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  console.log(`收到 ${signal}，正在停止服务`)
  const cancelledRequests = cancelAllRequests('server_shutdown')
  if (cancelledRequests > 0) {
    console.log(`已取消 ${cancelledRequests} 个活动请求`)
  }

  const forceExitTimer = setTimeout(() => {
    console.error('服务未能在 10 秒内停止，强制关闭连接')
    server.closeAllConnections()
    process.exit(1)
  }, 10_000)
  forceExitTimer.unref()

  server.close((error) => {
    clearTimeout(forceExitTimer)
    if (error) {
      console.error('停止服务失败：', error)
      process.exit(1)
    }
    try {
      closeConversationStore()
      closeAuthSessionStores()
    } catch (storeError) {
      console.error('关闭会话存储失败：', storeError)
      process.exit(1)
    }
    console.log('服务已停止')
    process.exit(0)
  })
}
