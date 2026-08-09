import 'highlight.js/styles/github-dark.css'

/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Sanitized Markdown generates real code-copy buttons, so click delegation keeps those generated controls functional without adding unsanitized React nodes. */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { renderMarkdown } from '#utils/markdownRenderer'

const RENDER_THROTTLE_MS = 160

type MarkdownMessageProps = {
  className?: string
  content: string
  streaming?: boolean
}

export function MarkdownMessage({ className = '', content, streaming = false }: MarkdownMessageProps) {
  const [renderedContent, setRenderedContent] = useState(streaming ? '' : content)
  const renderTimerRef = useRef<number | null>(null)
  const lastRenderedAtRef = useRef(0)

  useEffect(() => {
    if (renderTimerRef.current !== null) {
      window.clearTimeout(renderTimerRef.current)
      renderTimerRef.current = null
    }

    const renderNow = () => {
      renderTimerRef.current = null
      setRenderedContent(content)
      lastRenderedAtRef.current = performance.now()
    }

    if (!streaming) {
      renderNow()
      return
    }

    const throttle = content.length > 40_000 ? 420 : content.length > 12_000 ? 260 : RENDER_THROTTLE_MS
    const delay = Math.max(throttle - (performance.now() - lastRenderedAtRef.current), 0)
    if (delay === 0) {
      renderNow()
      return
    }

    renderTimerRef.current = window.setTimeout(renderNow, delay)
    return () => {
      if (renderTimerRef.current !== null) {
        window.clearTimeout(renderTimerRef.current)
        renderTimerRef.current = null
      }
    }
  }, [content, streaming])

  const html = useMemo(
    () => renderMarkdown(renderedContent, { highlightCode: !streaming }),
    [renderedContent, streaming],
  )

  async function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const button = target.closest<HTMLButtonElement>('[data-code-copy]')
    if (!button) return

    const code = button.closest('.code-block')?.querySelector('code')?.textContent
    if (code == null) return

    try {
      await navigator.clipboard.writeText(code)
      const originalText = button.textContent || '复制'
      button.textContent = '已复制'
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = originalText
      }, 1_400)
    } catch {
      button.textContent = '复制失败'
    }
  }

  return (
    <div
      className={`markdown-message ${className}`.trim()}
      data-render-mode={streaming ? 'streaming-lite' : 'complete'}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => void handleClick(event)}
    />
  )
}
