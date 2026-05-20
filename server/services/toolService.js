import { getWeather } from '../utils/weatherHandler.js'

const toolsMap = {
  getWeather
}

async function executeToolCalls(toolCalls, options = {}) {
  const { signal, throwIfAborted } = options
  const toolResults = []

  for (const tool of toolCalls) {
    throwIfAborted?.(signal)

    const functionName = tool.function
    const args = tool.args

    if (toolsMap[functionName]) {
      try {
        const result = await toolsMap[functionName](args, {
          signal
        })
        throwIfAborted?.(signal)
        toolResults.push({
          function: functionName,
          args,
          result
        })
      } catch (err) {
        console.error(`Failed to call tool ${functionName}`, err)
        toolResults.push({
          function: functionName,
          args,
          result: `Failed to call tool ${err.message}`
        })
      }
    } else {
      console.error(`${functionName} tool do not exist`)
      toolResults.push({
        function: functionName,
        args,
        result: 'unknown tool'
      })
    }
  }

  return toolResults
}

export {
  executeToolCalls
}
