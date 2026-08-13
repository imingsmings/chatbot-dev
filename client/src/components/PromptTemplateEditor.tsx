import { Input } from '#components/ui/input'
import { Textarea } from '#components/ui/textarea'
import {
  MAX_CUSTOM_PROMPT_TEMPLATE_CONTENT_LENGTH,
  MAX_CUSTOM_PROMPT_TEMPLATE_NAME_LENGTH,
  type CustomPromptTemplateDraft,
} from '#utils/customPromptTemplates'
import { extractPromptTemplateVariables } from '#utils/promptTemplates'

type PromptTemplateEditorProps = {
  draft: CustomPromptTemplateDraft
  mode: 'create' | 'edit'
  onChange: (draft: CustomPromptTemplateDraft) => void
}

export function PromptTemplateEditor({ draft, mode, onChange }: PromptTemplateEditorProps) {
  const variables = extractPromptTemplateVariables(draft.content)

  return (
    <div className="template-editor flex min-w-0 flex-col gap-4">
      <div>
        <h4 className="m-0 text-sm font-semibold">{mode === 'create' ? '新建自定义模板' : '编辑自定义模板'}</h4>
        <p className="mt-1.5 mb-0 text-xs leading-5 text-[var(--text-tertiary)]">在内容中使用 {'{变量名}'} 创建填充字段，支持中文、字母、数字、下划线和连字符。</p>
      </div>
      <label className="settings-field flex flex-col gap-[7px] text-xs font-semibold text-[var(--text-secondary)]" htmlFor="custom-template-name">
        <span>模板名称</span>
        <Input
          id="custom-template-name"
          maxLength={MAX_CUSTOM_PROMPT_TEMPLATE_NAME_LENGTH}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="例如：代码重构建议"
          value={draft.name}
        />
      </label>
      <label className="settings-field flex min-h-0 flex-1 flex-col gap-[7px] text-xs font-semibold text-[var(--text-secondary)]" htmlFor="custom-template-content">
        <span>模板内容</span>
        <Textarea
          className="min-h-56 flex-1 resize-y font-mono text-[13px] leading-6"
          id="custom-template-content"
          maxLength={MAX_CUSTOM_PROMPT_TEMPLATE_CONTENT_LENGTH}
          onChange={(event) => onChange({ ...draft, content: event.target.value })}
          placeholder={'请分析以下 {language} 代码：\n\n{code}'}
          value={draft.content}
        />
      </label>
      <div className="rounded-[7px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
        {variables.length > 0
          ? <>识别到变量：{variables.map((variable) => `{${variable.name}}`).join('、')}</>
          : '当前没有变量，应用时会直接填入完整模板内容。'}
      </div>
    </div>
  )
}
