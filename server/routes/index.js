const express = require('express')
const router = express.Router()
const { buildFunctionCallPrompt, buildStandardPrompt, buildAnswerPrompt } = require('../utils/promptTemplates')
const { callLLM, callLLMStream } = require('../utils/llm')
const { getWeather } = require('../utils/weatherHandler')

const conversations = []
const toolsMap = {
  getWeather
}

router.post('/ask', async (req, res) => {
  const question = req.body.question || ''

  res.setHeader('Cache-Control', 'no-cache')

  let finalResponse = ''
  const functionCallPrompt = buildFunctionCallPrompt(question)
  const functionCallResult = await callLLM(functionCallPrompt)

  if (functionCallResult.trim() === '无函数调用') {
    const prompt = buildStandardPrompt(question, conversations)
    finalResponse = await callLLMStream(prompt, (chunk) => {
      res.write(`${JSON.stringify({ response: chunk })}\n`)
    })
  } else {
    try {
      const toolCalls = JSON.parse(functionCallResult)
      const toolResults = []

      for (const tool of toolCalls) {
        const functionName = tool.function
        const args = tool.args

        if (toolsMap[functionName]) {
          try {
            const result = await toolsMap[functionName](args)
            toolResults.push({
              function: functionName,
              args,
              result: result
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
            result: `unknown tool`
          })
        }
      }

      const answerPrompt = buildAnswerPrompt(question, toolResults)
      finalResponse = await callLLMStream(answerPrompt, (chunk) => {
        res.write(`${JSON.stringify({ response: chunk })}\n`)
      })
    } catch (err) {
      console.error(`Failed to parse tool json：${err}`)
    }
  }

  conversations.push({ role: 'user', content: question }, { role: 'assistant', content: finalResponse })

  res.end()
})

router.get('/history', function (req, res) {
  res.json({
    conversations
  })
})

router.post('/clear', function (req, res) {
  conversations.length = 0
  res.json({
    message: '对话历史已经清空'
  })
})

module.exports = router
