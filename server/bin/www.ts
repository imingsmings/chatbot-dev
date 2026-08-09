#!/usr/bin/env node

import debugLib from 'debug'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import createApp from '../app.ts'
import { getDeploymentConfig, loadTlsServerOptions } from '../config/deploymentConfig.ts'

const debug = debugLib('server:server')
const deployment = getDeploymentConfig()
const app = createApp({ clientHosting: deployment.client })
const server = deployment.https.enabled
  ? https.createServer(loadTlsServerOptions(deployment.https), app)
  : http.createServer(app)

app.set('port', deployment.port)
server.on('error', onError)
server.on('listening', onListening)

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
}
