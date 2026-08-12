function sse(content) {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    `data: ${JSON.stringify({
      choices: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 2,
      },
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
}

function sseToolCall({ id = 'call_mock_1', name, argsText, reasoningContent = '' }) {
  const splitAt = Math.max(1, Math.floor(argsText.length / 2))
  const firstArgs = argsText.slice(0, splitAt)
  const secondArgs = argsText.slice(splitAt)

  return [
    reasoningContent
      ? `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoningContent } }] })}\n\n`
      : '',
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id,
            type: 'function',
            function: {
              name,
              arguments: ''
            }
          }]
        }
      }]
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: {
              arguments: firstArgs
            }
          }]
        }
      }]
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: {
              arguments: secondArgs
            }
          }]
        },
        finish_reason: 'tool_calls'
      }]
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 3,
        total_tokens: 11,
        prompt_cache_hit_tokens: 1,
      },
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
}

function writeSse(res, content) {
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
}

export {
  sse,
  sseToolCall,
  writeSse,
}
