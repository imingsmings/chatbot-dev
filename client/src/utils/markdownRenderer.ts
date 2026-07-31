import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdownLanguage from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import MarkdownIt from 'markdown-it'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('css', css)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdownLanguage)
hljs.registerLanguage('python', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)

function createMarkdownRenderer(highlightCode: boolean) {
  const markdown = new MarkdownIt({
    breaks: true,
    html: false,
    linkify: true,
    typographer: true,
  })

  markdown.disable('image')

  markdown.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index]
    const language = token.info.trim().split(/\s+/)[0] || ''
    const safeLanguage = /^[a-z0-9_-]+$/i.test(language) ? language : ''
    const languageLabel = safeLanguage || 'text'
    let code = markdown.utils.escapeHtml(token.content)

    if (highlightCode) {
      if (safeLanguage && hljs.getLanguage(safeLanguage)) {
        code = hljs.highlight(token.content, {
          language: safeLanguage,
          ignoreIllegals: true,
        }).value
      } else {
        code = hljs.highlightAuto(token.content).value
      }
    }

    const className = safeLanguage ? ` class="language-${safeLanguage}"` : ''
    return [
      '<div class="code-block">',
      '<div class="code-block-toolbar">',
      `<span class="code-language">${markdown.utils.escapeHtml(languageLabel)}</span>`,
      '<button class="code-copy-btn" type="button" data-code-copy>复制</button>',
      '</div>',
      `<pre><code${className}>${code}</code></pre>`,
      '</div>',
    ].join('')
  }

  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index].attrGet('href') || ''
    if (/^https?:\/\//i.test(href)) {
      tokens[index].attrSet('target', '_blank')
      tokens[index].attrSet('rel', 'noopener noreferrer nofollow')
    }
    return self.renderToken(tokens, index, options)
  }

  return markdown
}

const completeMarkdown = createMarkdownRenderer(true)
const streamingMarkdown = createMarkdownRenderer(false)

export function renderMarkdown(content: string, options: { highlightCode?: boolean } = {}) {
  const renderer = options.highlightCode === false ? streamingMarkdown : completeMarkdown
  return DOMPurify.sanitize(renderer.render(content), {
    ADD_ATTR: ['target', 'rel', 'data-code-copy'],
    FORBID_TAGS: ['img'],
  })
}
