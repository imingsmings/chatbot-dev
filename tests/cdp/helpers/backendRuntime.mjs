import path from 'node:path'

function readBackendRuntime(env = process.env) {
  const runtime = env.CHATBOT_SERVER_RUNTIME?.trim() || 'bun'
  if (runtime !== 'bun') {
    throw new Error('CHATBOT_SERVER_RUNTIME must be bun')
  }

  const directory = env.CHATBOT_SERVER_DIR?.trim() || 'bun-server'
  return { runtime, directory }
}

function createBackendSpawnOptions(repoRoot, options = {}) {
  const { runtime, directory } = readBackendRuntime(options.env)
  const preloads = options.preloads || []
  const args = []
  const env = { ...(options.env || process.env) }

  for (const preload of preloads) args.push('--preload', preload)

  args.push('./bin/www.ts')
  return {
    command: runtime,
    args,
    cwd: path.resolve(repoRoot, directory),
    env,
  }
}

export { createBackendSpawnOptions, readBackendRuntime }
