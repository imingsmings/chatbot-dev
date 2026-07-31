import type { CalculatorToolArgs, ToolRegistryItem } from '../types/tools.ts'

const MAX_EXPRESSION_LENGTH = 200

class ExpressionParser {
  private index = 0
  private readonly source: string

  constructor(source: string) {
    this.source = source
  }

  parse(): number {
    const value = this.parseExpression()
    this.skipWhitespace()

    if (this.index !== this.source.length) {
      throw new Error(`无法解析位置 ${this.index + 1} 附近的内容`)
    }

    if (!Number.isFinite(value)) {
      throw new Error('计算结果不是有限数字')
    }

    return value
  }

  private parseExpression(): number {
    let value = this.parseTerm()

    while (true) {
      if (this.consume('+')) {
        value += this.parseTerm()
      } else if (this.consume('-')) {
        value -= this.parseTerm()
      } else {
        return value
      }
    }
  }

  private parseTerm(): number {
    let value = this.parsePower()

    while (true) {
      if (this.consume('*')) {
        value *= this.parsePower()
      } else if (this.consume('/')) {
        const divisor = this.parsePower()
        if (divisor === 0) throw new Error('不能除以 0')
        value /= divisor
      } else if (this.consume('%')) {
        const divisor = this.parsePower()
        if (divisor === 0) throw new Error('不能对 0 取余')
        value %= divisor
      } else {
        return value
      }
    }
  }

  private parsePower(): number {
    const base = this.parseUnary()
    if (this.consume('^')) {
      return base ** this.parsePower()
    }
    return base
  }

  private parseUnary(): number {
    if (this.consume('+')) return this.parseUnary()
    if (this.consume('-')) return -this.parseUnary()
    return this.parsePrimary()
  }

  private parsePrimary(): number {
    if (this.consume('(')) {
      const value = this.parseExpression()
      if (!this.consume(')')) {
        throw new Error('缺少右括号')
      }
      return value
    }

    this.skipWhitespace()
    const remaining = this.source.slice(this.index)
    const match = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)
    if (!match) {
      throw new Error(`位置 ${this.index + 1} 需要数字或左括号`)
    }

    this.index += match[0].length
    return Number(match[0])
  }

  private consume(token: string): boolean {
    this.skipWhitespace()
    if (!this.source.startsWith(token, this.index)) {
      return false
    }
    this.index += token.length
    return true
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.index] || '')) {
      this.index += 1
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateCalculatorArgs(args: unknown): CalculatorToolArgs {
  const value = isRecord(args) ? args : {}
  const expression = typeof value.expression === 'string' ? value.expression.trim() : ''

  if (!expression) {
    throw new Error('expression 必须是非空字符串')
  }

  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`expression 长度不能超过 ${MAX_EXPRESSION_LENGTH}`)
  }

  if (!/^[\d+\-*/%^().eE\s]+$/.test(expression)) {
    throw new Error('expression 包含不支持的字符')
  }

  return { expression }
}

function calculateExpression(expression: string): number {
  return new ExpressionParser(expression).parse()
}

const calculatorTool: ToolRegistryItem<CalculatorToolArgs> = {
  name: 'calculate',
  definition: {
    type: 'function',
    function: {
      name: 'calculate',
      description: '计算只包含数字、括号和 +、-、*、/、%、^ 运算符的数学表达式。',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，例如 (12 + 8) * 3 / 2'
          }
        },
        required: ['expression'],
        additionalProperties: false
      }
    }
  },
  validateArgs: validateCalculatorArgs,
  async handler(args) {
    const result = calculateExpression(args.expression)
    return `计算结果：${Number.isInteger(result) ? String(result) : String(Number(result.toPrecision(12)))}`
  }
}

export {
  calculateExpression,
  calculatorTool,
  validateCalculatorArgs
}
