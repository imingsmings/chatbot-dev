import { CheckIcon, ChevronDownIcon, ImageIcon, XIcon } from 'lucide-react'
import { useId, useRef } from 'react'

import { Button } from '#components/ui/button'
import { DialogContent, DialogRoot, DialogTitle } from '#components/ui/dialog'
import { getEffortLabel } from '#components/ModelOptionsMenu'
import type { ModelRequestOptions, RuntimeInfo } from '#types/chat'
import { formatReasoningEffort } from '#utils/displayNames'
import { getModelDescriptor, getRuntimeProviders, selectModelOptions } from '#utils/modelOptions'

type MobileModelSheetProps = {
  disabled: boolean
  saving: boolean
  open: boolean
  options: ModelRequestOptions
  runtime: RuntimeInfo | null
  onChange: (options: ModelRequestOptions) => void
  onOpenChange: (open: boolean) => void
}

export function MobileModelSheet(props: MobileModelSheetProps) {
  const model = getModelDescriptor(props.runtime, props.options)
  const providers = getRuntimeProviders(props.runtime)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const effort = getEffortLabel(props.options)
  const effortOptions = [
    { label: '关闭', value: 'off' },
    ...(model?.capabilities.reasoningEfforts ?? [])
      .filter((value) => value !== 'none')
      .map((value) => ({ label: formatReasoningEffort(value), value })),
  ]

  return (
    <>
      <Button
        aria-label={model ? `选择模型：${model.label}` : '模型目录不可用'}
        aria-haspopup="dialog"
        aria-expanded={props.open && Boolean(model)}
        aria-controls={props.open && model ? id : undefined}
        aria-busy={props.saving || undefined}
        className="model-menu-trigger mobile-model-trigger"
        disabled={props.disabled || !model}
        focusableWhenDisabled={props.saving}
        onClick={() => props.onOpenChange(true)}
        ref={triggerRef}
        variant="ghost"
      >
        <span className="model-trigger-label">{model?.label ?? '模型不可用'}</span>
        <ChevronDownIcon aria-hidden="true" size={14} />
      </Button>
      <DialogRoot open={props.open && Boolean(model)} onOpenChange={props.onOpenChange}>
        <DialogContent className="mobile-model-sheet" side="bottom" id={id} initialFocus={closeRef} finalFocus={triggerRef}>
          <header className="mobile-model-sheet-header">
            <DialogTitle>模型与思考</DialogTitle>
            <output aria-live="polite" className="model-save-state">{props.saving ? '保存中...' : ''}</output>
            <Button aria-label="关闭模型选择" className="mobile-sheet-close" onClick={() => props.onOpenChange(false)} ref={closeRef} size="icon" variant="ghost">
              <XIcon aria-hidden="true" size={18} />
            </Button>
          </header>
          <div className="mobile-model-sheet-body" aria-busy={props.saving || undefined}>
            <div aria-label="模型" role="radiogroup" className="mobile-model-list">
              {providers.map((provider) => (
                <fieldset className="mobile-model-group" key={provider.id}>
                  <legend className="submenu-heading">{provider.label}</legend>
                  {provider.models.map((item) => {
                    const selected = item.id === model?.id && item.provider === model.provider
                    const unavailable = !provider.configured || item.disabled
                    return (
                      <label className="mobile-model-choice" data-selected={selected} data-unavailable={Boolean(unavailable)} key={item.id}>
                        <input aria-label={`选择 ${item.label}`} checked={selected} className="sr-only" disabled={props.disabled || unavailable} name={`${id}-model`} onChange={() => props.onChange(selectModelOptions(props.options, item))} type="radio" value={`${item.provider}:${item.id}`} />
                        <span className="option-label">{item.label}</span>
                        {unavailable ? <span className="option-status">{provider.configured ? '不可用' : '未配置'}</span>
                          : selected ? <CheckIcon aria-hidden="true" size={16} />
                            : item.capabilities.inputModalities?.includes('image') ? <ImageIcon aria-label="支持图片" size={16} /> : null}
                      </label>
                    )
                  })}
                </fieldset>
              ))}
            </div>
            {model?.capabilities.reasoning ? (
              <fieldset className="mobile-effort-group">
                <legend className="submenu-heading">思考强度</legend>
                <div className="mobile-effort-options">
                  {effortOptions.map((item) => (
                    <label className="mobile-effort-choice" data-selected={item.label === effort} key={item.value}>
                      <input
                        aria-label={`思考强度 ${item.label}`}
                        checked={item.label === effort}
                        className="sr-only"
                        disabled={props.disabled}
                        name={`${id}-effort`}
                        onChange={() => props.onChange({ ...props.options, reasoningEnabled: item.value !== 'off', reasoningEffort: item.value === 'off' ? props.options.reasoningEffort : item.value })}
                        type="radio"
                        value={item.value}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  )
}
