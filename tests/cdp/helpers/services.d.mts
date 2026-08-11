import type { ChildProcess } from 'node:child_process'

type ProcessHandle = {
  child: ChildProcess
  cleanupPaths?: string[]
  getOutput: () => string
  killGroup: boolean
}

export function delay(ms: number): Promise<void>
export function spawnProcess(
  command: string,
  args: string[],
  options?: Record<string, unknown> & { killGroup?: boolean },
): ProcessHandle
export function stopProcess(
  processHandle: ProcessHandle | ChildProcess | null | undefined,
): Promise<void>
export function waitForProcessExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean>
export function waitForHttp(
  url: string,
  timeoutMs?: number,
  options?: { acceptStatus?: (response: Response) => boolean },
): Promise<boolean>
