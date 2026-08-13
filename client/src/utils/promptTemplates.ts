export type PromptTemplateVariable = {
  name: string
  label: string
  placeholder: string
  multiline?: boolean
}

export type PromptTemplate = {
  id: string
  name: string
  content: string
  variables: PromptTemplateVariable[]
}

const PROMPT_VARIABLE_PATTERN = /\{([\p{L}_][\p{L}\p{N}_-]{0,39})\}/gu

export function extractPromptTemplateVariables(content: string): PromptTemplateVariable[] {
  const names = [...content.matchAll(PROMPT_VARIABLE_PATTERN)].map((match) => match[1])
  const uniqueNames = [...new Set(names)]

  return uniqueNames.map((name) => ({
    name,
    label: name,
    placeholder: `填写 ${name}`,
    multiline: content.split('\n').some((line) => line.trim() === `{${name}}`),
  }))
}

export const promptTemplates: PromptTemplate[] = [
  {
    id: 'explain-code',
    name: '代码解释',
    content: [
      '请解释下面这段 {language} 代码。',
      '重点说明：整体目标、执行流程、关键数据结构、边界情况和可能的改进点。',
      '',
      '```{language}',
      '{code}',
      '```',
    ].join('\n'),
    variables: [
      { name: 'language', label: '语言', placeholder: 'TypeScript' },
      { name: 'code', label: '代码', placeholder: '粘贴代码', multiline: true },
    ],
  },
  {
    id: 'bug-analysis',
    name: 'Bug 分析',
    content: [
      '请分析下面的问题并给出可验证的修复方案。',
      '',
      '现象：{symptom}',
      '相关代码或日志：',
      '{context}',
      '',
      '请区分根因、证据、修复步骤和回归测试。',
    ].join('\n'),
    variables: [
      { name: 'symptom', label: '现象', placeholder: '描述异常表现' },
      { name: 'context', label: '代码或日志', placeholder: '粘贴相关内容', multiline: true },
    ],
  },
  {
    id: 'technical-review',
    name: '技术方案评审',
    content: [
      '请评审下面的技术方案：',
      '{proposal}',
      '',
      '目标：{goal}',
      '请从正确性、复杂度、扩展性、风险、测试和替代方案六个方面给出结论。',
    ].join('\n'),
    variables: [
      { name: 'goal', label: '目标', placeholder: '方案要解决的问题' },
      { name: 'proposal', label: '方案', placeholder: '粘贴技术方案', multiline: true },
    ],
  },
  {
    id: 'translate-polish',
    name: '翻译润色',
    content: [
      '请将下面内容翻译为{language}并润色，保持原意和专业术语准确。',
      '语气：{tone}',
      '',
      '{text}',
    ].join('\n'),
    variables: [
      { name: 'language', label: '目标语言', placeholder: '英文' },
      { name: 'tone', label: '语气', placeholder: '专业、简洁' },
      { name: 'text', label: '原文', placeholder: '粘贴原文', multiline: true },
    ],
  },
  {
    id: 'weekly-summary',
    name: '周报总结',
    content: [
      '请把下面的工作记录整理成周报。',
      '按本周完成、问题与风险、下周计划输出，删除重复内容并保留可量化结果。',
      '',
      '{notes}',
    ].join('\n'),
    variables: [{ name: 'notes', label: '工作记录', placeholder: '粘贴记录', multiline: true }],
  },
  {
    id: 'learning-plan',
    name: '学习计划',
    content: [
      '请为“{topic}”制定学习计划。',
      '当前基础：{level}',
      '可用时间：{time}',
      '目标：{goal}',
      '',
      '按阶段列出练习、验收标准和推荐资料类型。',
    ].join('\n'),
    variables: [
      { name: 'topic', label: '主题', placeholder: '例如 LLM 应用开发' },
      { name: 'level', label: '当前基础', placeholder: '描述已有经验' },
      { name: 'time', label: '可用时间', placeholder: '例如每周 5 小时' },
      { name: 'goal', label: '目标', placeholder: '希望达到的能力' },
    ],
  },
]

export function renderPromptTemplate(
  template: PromptTemplate,
  values: Record<string, string>,
): string {
  return template.content.replace(PROMPT_VARIABLE_PATTERN, (_, name: string) => {
    return values[name] ?? ''
  })
}
