export type ChatPerformanceMark = {
  at: number
  detail?: Record<string, number | string | boolean>
  name:
    | 'assistant-update'
    | 'markdown-render'
    | 'message-row-render'
    | 'scroll-execute'
    | 'scroll-schedule'
    | 'stream-event'
}

type ChatPerformanceDiagnostics = {
  enabled: boolean
  marks: ChatPerformanceMark[]
}

declare global {
  interface Window {
    __chatbotPerformanceDiagnostics?: ChatPerformanceDiagnostics
  }
}

export function recordChatPerformance(
  name: ChatPerformanceMark['name'],
  detail?: ChatPerformanceMark['detail'],
): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return

  const diagnostics = window.__chatbotPerformanceDiagnostics
  if (!diagnostics?.enabled) return

  diagnostics.marks.push({
    at: performance.now(),
    detail,
    name,
  })
}
