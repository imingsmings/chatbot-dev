type BackendRuntime = {
  runtime: 'node' | 'bun'
  directory: string
}

type BackendSpawnOptions = {
  command: 'node' | 'bun'
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

export function readBackendRuntime(env?: NodeJS.ProcessEnv): BackendRuntime
export function createBackendSpawnOptions(
  repoRoot: string,
  options?: {
    env?: NodeJS.ProcessEnv
    preloads?: string[]
  },
): BackendSpawnOptions
