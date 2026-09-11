import { CheckIcon, ChevronDownIcon, ImageIcon } from 'lucide-react'

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal,
  DropdownMenuPositioner, DropdownMenuSeparator, DropdownMenuTrigger,
} from '#components/ui/dropdown-menu'
import { Button } from '#components/ui/button'
import { cn } from '#lib/utils'
import type { ModelRequestOptions, RuntimeInfo } from '#types/chat'
import { formatReasoningEffort } from '#utils/displayNames'
import { getModelDescriptor, getRuntimeProviders, selectModelOptions } from '#utils/modelOptions'

type ModelOptionsMenuProps = {
  disabled: boolean
  open: boolean
  effortOpen: boolean
  options: ModelRequestOptions
  runtime: RuntimeInfo | null
  onChange: (options: ModelRequestOptions) => void
  onOpenChange: (open: boolean) => void
  onEffortOpenChange: (open: boolean) => void
}

export function getModelLabel(options: ModelRequestOptions, runtime: RuntimeInfo | null = null) {
  return getModelDescriptor(runtime, options)?.label ?? '模型不可用'
}

export function getEffortLabel(options: ModelRequestOptions) {
  if (options.reasoningEnabled === false) return '关闭'
  return formatReasoningEffort(options.reasoningEffort || 'low')
}

export function ModelOptionsMenu(props: ModelOptionsMenuProps) {
  const model = getModelDescriptor(props.runtime, props.options)
  const providers = getRuntimeProviders(props.runtime)
  if (!model) {
    return <Button aria-label="模型目录不可用" className="model-menu-trigger" disabled variant="ghost">模型不可用</Button>
  }
  const effortLabel = getEffortLabel(props.options)
  const effortOptions = [
    { label: '关闭', value: 'off' },
    ...model.capabilities.reasoningEfforts.filter((value) => value !== 'none')
      .map((value) => ({ label: formatReasoningEffort(value), value })),
  ]

  return (
    <>
      <DropdownMenu onOpenChange={props.onOpenChange} open={props.open}>
        <DropdownMenuTrigger
          aria-label={`选择模型：${model.label}`}
          disabled={props.disabled}
          render={<Button className="model-menu-trigger" variant="ghost" />}
        >
          <span className="model-trigger-label">{model.label}</span>
          <ChevronDownIcon aria-hidden="true" size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner align="end" className="menu-positioner" side="top" sideOffset={8} collisionPadding={12}>
            <DropdownMenuContent aria-label="模型" className="dropdown-menu model-options-menu model-submenu">
              {providers.map((provider, index) => (
                <fieldset className="model-provider-group" key={provider.id} aria-label={provider.label}>
                  {index > 0 ? <DropdownMenuSeparator className="model-provider-separator" /> : null}
                  <div className="submenu-heading">{provider.label}</div>
                  {provider.models.map((item) => {
                    const selected = item.id === model.id && item.provider === model.provider
                    const unavailable = !provider.configured || item.disabled
                    return (
                      <DropdownMenuItem
                        aria-label={`选择 ${item.label}`}
                        aria-checked={selected}
                        className={cn('dropdown-menu-item option-item', selected && 'selected')}
                        disabled={unavailable}
                        key={item.id}
                        nativeButton
                        onClick={() => { props.onChange(selectModelOptions(props.options, item)); props.onOpenChange(false) }}
                        render={<button aria-label={`选择 ${item.label}`} type="button" />}
                        role="menuitemradio"
                      >
                        <span className="option-label">{item.label}</span>
                        {unavailable ? <span className="option-status">{provider.configured ? '不可用' : '未配置'}</span>
                          : selected ? <CheckIcon aria-hidden="true" size={16} />
                            : item.capabilities.inputModalities?.includes('image') ? <ImageIcon aria-label="支持图片" size={16} /> : null}
                      </DropdownMenuItem>
                    )
                  })}
                </fieldset>
              ))}
            </DropdownMenuContent>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenu>
      {model.capabilities.reasoning ? (
        <DropdownMenu onOpenChange={props.onEffortOpenChange} open={props.effortOpen}>
          <DropdownMenuTrigger
            aria-label={`思考强度：${effortLabel}`}
            disabled={props.disabled}
            render={<Button className="effort-menu-trigger" variant="ghost" />}
          >
            <span><span className="effort-prefix">思考 · </span>{effortLabel}</span>
            <ChevronDownIcon aria-hidden="true" size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner align="end" className="menu-positioner" side="top" sideOffset={8} collisionPadding={12}>
              <DropdownMenuContent aria-label="思考强度" className="dropdown-menu effort-submenu">
                <div className="submenu-heading">思考强度</div>
                {effortOptions.map((effort) => {
                  const selected = effort.label === effortLabel
                  return (
                    <DropdownMenuItem
                      aria-label={`思考强度 ${effort.label}`}
                      aria-checked={selected}
                      className={cn('dropdown-menu-item option-item', selected && 'selected')}
                      key={effort.value}
                      nativeButton
                      onClick={() => {
                        props.onChange({ ...props.options, reasoningEnabled: effort.value !== 'off', reasoningEffort: effort.value === 'off' ? props.options.reasoningEffort : effort.value })
                        props.onEffortOpenChange(false)
                      }}
                      render={<button aria-label={`思考强度 ${effort.label}`} type="button" />}
                      role="menuitemradio"
                    >
                      <span>{effort.label}</span>
                      {selected ? <CheckIcon aria-hidden="true" size={16} /> : null}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenu>
      ) : null}
    </>
  )
}
