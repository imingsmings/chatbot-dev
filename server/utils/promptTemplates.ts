import type { PromptMessage, StoredMessage } from '../types/conversation.ts'
import type { ToolResult } from '../types/tools.ts'

function buildFunctionCallPrompt(userInput: string): PromptMessage[] {
  const content = `
    你是一个中文智能助手，具有工具调用能力。请严格按照以下规则回复：
    
    请根据用户的输入内容判断是否需要调用函数工具，规则如下：
    
    1. 如果不需要调用函数工具，请直接返回字符串："无函数调用"（必须完全一致）
    2. 如果需要调用函数，请返回标准JSON数组格式。
    
    JSON格式示例（正确）：（数组套对象的形式）
    [
      {
        "function": "getWeather", 
        "args": { "city": "北京", "date": "明天" }
      }
    ]
    
    ✅ 正确格式（必须这样写）：
    - { "city": "北京", "date": "明天" }     # 标准JSON格式
    
    关键要求：
    - 参数值只需要一层双引号，不要嵌套引号
    - 中文文本直接放在双引号内，不需要额外处理
    - 必须是有效的JSON，能够被JSON.parse()正确解析
    
    目前你支持的函数列表如下：
    - getWeather：获取城市的天气信息
      参数要求：
      * city: 城市名称（必须是中文，如北京、上海、成都）
      * date: 日期（必须是中文，只能是：今天、明天、后天）
    
    严格要求：
    - 如果不需要调用函数，只返回"无函数调用"这5个字
    - 如果需要调用函数，只返回JSON数组，不要包含其他文字解释
    - 所有参数值必须使用中文，禁止使用英文
    - date参数只能是"今天"、"明天"、"后天"，不能是其他格式
    - JSON必须严格正确，不能有双引号嵌套问题
    
    ⚠️ 特别注意：返回的JSON必须能被JSON.parse()正确解析，任何格式错误都会导致系统无法处理！
    
    以下是用户的输入，请根据内容判断是否需要函数调用：
    
    【${userInput}】
    
    记住：如果需要调用函数，请确保返回的JSON格式完全正确，参数值不要有额外的引号！
    `.trim()

  return [
    {
      role: 'user',
      content
    }
  ]
}

function buildAnswerPrompt(userInput: string, results: ToolResult[]): PromptMessage[] {
  const toolsText = results
    .map((item) => {
      const { function: fn, args, result } = item
      return `函数：${fn}\n参数：${JSON.stringify(args)}\n返回结果：${result}`
    })
    .join('\n\n')

  const content = `
      你是一个友好的中文智能助手，已经执行了相关函数调用，以下是函数返回结果：
      
      ${toolsText}
      
      请基于上述工具结果，严格使用中文自然语言回答用户的问题。
      
      要求：
      - 使用友好、自然的语调
      - 如果工具调用成功，直接提供结果信息
      - 如果工具调用失败，友好地告知用户并建议重新尝试
      - 不要暴露技术细节或系统错误信息
      - 回答要简洁明了
      - 如果未找到相关工具，请你自行处理
      
      用户原始输入是：
      【${userInput}】
      `.trim()

  return [
    {
      role: 'user',
      content
    }
  ]
}

function buildStandardPrompt(userInput: string, conversations: StoredMessage[]): PromptMessage[] {
  // return [
  //   `你是一个中文智能助手，请使用中文回答用户的问题。`,
  //   ...conversations.map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`),
  //   ` 问题：${userInput}`
  // ].join('\n')

  return [
    {
      role: 'system',
      content: '你是一个中文智能助手，请使用中文回答用户的问题。'
    },
    ...conversations,
    {
      role: 'user',
      content: userInput
    }
  ]
}

export {
  buildFunctionCallPrompt,
  buildStandardPrompt,
  buildAnswerPrompt
}
