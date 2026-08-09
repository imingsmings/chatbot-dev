import { describe, expect, it } from 'vitest'

import { renderMarkdown } from '../../../client/src/utils/markdownRenderer'

describe('Markdown renderer', () => {
  it('sanitizes unsafe HTML and blocks images', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n![remote](https://example.com/tracker.png)',
    )

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain(
      '<a href="https://example.com/tracker.png" target="_blank" rel="noopener noreferrer nofollow">remote</a>',
    )
  })

  it('adds safe attributes only to external HTTP links', () => {
    const html = renderMarkdown('[external](https://example.com) [relative](/docs)')

    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">',
    )
    expect(html).toContain('<a href="/docs">relative</a>')
  })

  it('keeps streaming rendering lightweight and highlights completed code', () => {
    const markdown = '```typescript\nconst answer: number = 42\n```'
    const streaming = renderMarkdown(markdown, { highlightCode: false })
    const complete = renderMarkdown(markdown)

    expect(streaming).toContain('data-code-copy')
    expect(streaming).toContain('language-typescript')
    expect(streaming).not.toContain('hljs-keyword')
    expect(complete).toContain('hljs-keyword')
  })
})
