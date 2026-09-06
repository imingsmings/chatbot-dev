import { createPrivateKey, X509Certificate } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 7001
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_CERTIFICATE_PATH = '~/devhttps/dev-cert.pem'
const DEFAULT_PRIVATE_KEY_PATH = '~/devhttps/dev-key.pem'
const DEFAULT_CLIENT_DIST_DIR = fileURLToPath(new URL('../../client/dist', import.meta.url))

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled'])

type DeploymentConfig = {
  host: string
  port: number | string
  client: {
    enabled: boolean
    distDir: string
  }
  https: {
    enabled: boolean
    certificatePath: string
    privateKeyPath: string
    certificateAuthorityPath?: string
  }
}

function readBoolean(
  value: string | undefined,
  name: string,
  fallback: boolean
): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) {
    return true
  }
  if (FALSE_VALUES.has(normalized)) {
    return false
  }

  throw new Error(`${name} 必须是布尔值，例如 true/false、1/0、yes/no、on/off`)
}

function resolveConfiguredPath(value: string, userHome = homedir()): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('文件路径不能为空')
  }

  if (trimmed === '~') {
    return userHome
  }
  if (trimmed.startsWith('~/')) {
    return resolve(userHome, trimmed.slice(2))
  }
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed)
}

function normalizePort(value: string | undefined): number | string {
  const trimmed = value?.trim() || String(DEFAULT_PORT)
  if (/^-?\d+$/.test(trimmed)) {
    const port = Number(trimmed)
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error('PORT 必须是 0 到 65535 之间的整数或命名管道')
    }
    return port
  }
  return trimmed
}

function getDeploymentConfig(
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir()
): DeploymentConfig {
  const production = env.NODE_ENV === 'production'
  const certificateAuthorityPath = env.HTTPS_CA_PATH?.trim()

  return {
    host: env.HOST?.trim() || DEFAULT_HOST,
    port: normalizePort(env.PORT),
    client: {
      enabled: readBoolean(env.SERVE_CLIENT_BUILD, 'SERVE_CLIENT_BUILD', production),
      distDir: resolveConfiguredPath(env.CLIENT_DIST_DIR || DEFAULT_CLIENT_DIST_DIR, userHome)
    },
    https: {
      enabled: readBoolean(env.HTTPS_ENABLED, 'HTTPS_ENABLED', production),
      certificatePath: resolveConfiguredPath(
        env.HTTPS_CERT_PATH || DEFAULT_CERTIFICATE_PATH,
        userHome
      ),
      privateKeyPath: resolveConfiguredPath(
        env.HTTPS_KEY_PATH || DEFAULT_PRIVATE_KEY_PATH,
        userHome
      ),
      ...(certificateAuthorityPath
        ? { certificateAuthorityPath: resolveConfiguredPath(certificateAuthorityPath, userHome) }
        : {})
    }
  }
}

function readRequiredFile(path: string, label: string): Buffer {
  if (!existsSync(path)) {
    throw new Error(`${label}不存在：${path}`)
  }

  try {
    return readFileSync(path)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`无法读取${label}：${message}`)
  }
}

function loadTlsServerOptions(
  config: DeploymentConfig['https'],
  now = new Date(),
): BunRuntime.TLSOptions {
  if (!config.enabled) {
    throw new Error('HTTPS 未启用，不能加载 TLS 配置')
  }

  const cert = readRequiredFile(config.certificatePath, 'HTTPS 证书')
  const key = readRequiredFile(config.privateKeyPath, 'HTTPS 私钥')
  let certificate: X509Certificate

  try {
    certificate = new X509Certificate(cert)
  } catch {
    throw new Error('HTTPS 证书格式无效')
  }

  const validFrom = new Date(certificate.validFrom)
  const validTo = new Date(certificate.validTo)
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
    throw new Error('HTTPS 证书有效期无效')
  }
  if (now < validFrom) {
    throw new Error(`HTTPS 证书尚未生效：${certificate.validFrom}`)
  }
  if (now > validTo) {
    throw new Error(`HTTPS 证书已过期：${certificate.validTo}`)
  }

  try {
    const privateKey = createPrivateKey(key)
    if (!certificate.checkPrivateKey(privateKey)) {
      throw new Error('mismatch')
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'mismatch') {
      throw new Error('HTTPS 私钥与证书不匹配')
    }
    throw new Error('HTTPS 私钥格式无效或与证书不匹配')
  }

  return {
    cert,
    key,
    ...(config.certificateAuthorityPath
      ? { ca: readRequiredFile(config.certificateAuthorityPath, 'HTTPS CA 证书') }
      : {})
  }
}

export {
  DEFAULT_CLIENT_DIST_DIR,
  getDeploymentConfig,
  loadTlsServerOptions,
  normalizePort,
  readBoolean,
  resolveConfiguredPath
}
export type { DeploymentConfig }
