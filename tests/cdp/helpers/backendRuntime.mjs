import path from 'node:path'

function readBackendRuntime(env = process.env) {
  const runtime = env.CHATBOT_SERVER_RUNTIME?.trim() || 'node'
  if (runtime !== 'node' && runtime !== 'bun') {
    throw new Error('CHATBOT_SERVER_RUNTIME must be either node or bun')
  }

  const directory = env.CHATBOT_SERVER_DIR?.trim() || (runtime === 'bun' ? 'bun-server' : 'server')
  return { runtime, directory }
}

function createBackendSpawnOptions(repoRoot, options = {}) {
  const { runtime, directory } = readBackendRuntime(options.env)
  const preloads = options.preloads || []
  const args = []
  const env = { ...(options.env || process.env) }

  if (runtime === 'bun') {
    for (const preload of preloads) args.push('--preload', preload)
  } else if (preloads.length > 0) {
    const requires = preloads.map((preload) => `--require=${preload}`).join(' ')
    env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} ${requires}`.trim()
  }

  args.push('./bin/www.ts')
  return {
    command: runtime,
    args,
    cwd: path.resolve(repoRoot, directory),
    env,
  }
}

export { createBackendSpawnOptions, readBackendRuntime }
