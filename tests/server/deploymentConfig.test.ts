import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  getDeploymentConfig,
  loadTlsServerOptions,
  normalizePort,
  readBoolean,
  resolveConfiguredPath
} from '../../server/config/deploymentConfig.ts'

test('production deployment defaults enable built client hosting and HTTPS', () => {
  const config = getDeploymentConfig({ NODE_ENV: 'production' }, '/Users/tester')

  assert.equal(config.client.enabled, true)
  assert.equal(config.https.enabled, true)
  assert.equal(config.https.certificatePath, '/Users/tester/devhttps/dev-cert.pem')
  assert.equal(config.https.privateKeyPath, '/Users/tester/devhttps/dev-key.pem')
})

test('development deployment defaults remain HTTP with Vite-managed client', () => {
  const config = getDeploymentConfig({}, '/Users/tester')

  assert.equal(config.client.enabled, false)
  assert.equal(config.https.enabled, false)
  assert.equal(config.port, 7001)
  assert.equal(config.host, '0.0.0.0')
})

test('deployment config accepts explicit overrides and expands home paths', () => {
  const config = getDeploymentConfig({
    PORT: '7443',
    HOST: '127.0.0.1',
    SERVE_CLIENT_BUILD: 'yes',
    CLIENT_DIST_DIR: '~/build/client',
    HTTPS_ENABLED: 'on',
    HTTPS_CERT_PATH: '~/certs/site.pem',
    HTTPS_KEY_PATH: '/secure/site-key.pem',
    HTTPS_CA_PATH: './certs/ca.pem'
  }, '/Users/tester')

  assert.equal(config.port, 7443)
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.client.distDir, '/Users/tester/build/client')
  assert.equal(config.https.certificatePath, '/Users/tester/certs/site.pem')
  assert.equal(config.https.privateKeyPath, '/secure/site-key.pem')
  assert.equal(config.https.certificateAuthorityPath, resolve('./certs/ca.pem'))
})

test('deployment config rejects invalid booleans and ports', () => {
  assert.throws(() => readBoolean('sometimes', 'HTTPS_ENABLED', false), /HTTPS_ENABLED/)
  assert.throws(() => normalizePort('65536'), /0 到 65535/)
  assert.throws(() => normalizePort('-1'), /0 到 65535/)
  assert.equal(normalizePort('named-pipe'), 'named-pipe')
})

test('configured path rejects blanks and supports home directory itself', () => {
  assert.equal(resolveConfiguredPath('~', '/Users/tester'), '/Users/tester')
  assert.throws(() => resolveConfiguredPath('   '), /不能为空/)
})

test('TLS loader fails closed for disabled, missing, and malformed certificates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatbot-tls-test-'))
  const invalidCertificatePath = join(directory, 'invalid-cert.pem')
  const invalidKeyPath = join(directory, 'invalid-key.pem')
  try {
    await writeFile(invalidCertificatePath, 'not a certificate')
    await writeFile(invalidKeyPath, 'not a key')

    assert.throws(() => loadTlsServerOptions({
      enabled: false,
      certificatePath: invalidCertificatePath,
      privateKeyPath: invalidKeyPath
    }), /HTTPS 未启用/)

    assert.throws(() => loadTlsServerOptions({
      enabled: true,
      certificatePath: join(directory, 'missing.pem'),
      privateKeyPath: invalidKeyPath
    }), /HTTPS 证书不存在/)

    assert.throws(() => loadTlsServerOptions({
      enabled: true,
      certificatePath: invalidCertificatePath,
      privateKeyPath: invalidKeyPath
    }), /证书格式无效/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
