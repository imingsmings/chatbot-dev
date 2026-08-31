import { CheckIcon, ChevronRightIcon, SlidersHorizontalIcon } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu'
import { Button } from '#components/ui/button'
import { cn } from '#lib/utils'
import type { ModelDescriptor, ModelRequestOptions, RuntimeInfo } from '#types/chat'
import { formatReasoningEffort } from '#utils/displayNames'
import {
  getModelDescriptor,
  getRuntimeProviders,
  selectModelOptions,
} from '#utils/modelOptions'

type ModelOptionsMenuProps = {
  disabled: boolean
  open: boolean
  options: ModelRequestOptions
  runtime: RuntimeInfo | null
  onChange: (options: ModelRequestOptions) => void
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
}

export function getModelLabel(options: ModelRequestOptions, runtime: RuntimeInfo | null = null) {
  return getModelDescriptor(runtime, options)?.label ?? 'Model unavailable'
}

export function getEffortLabel(options: ModelRequestOptions) {
  if (options.reasoningEnabled === false) return 'Off'
  return formatReasoningEffort(options.reasoningEffort || 'low')
}

export function ModelOptionsMenu({
  disabled,
  open,
  options,
  runtime,
  onChange,
  onOpenChange,
  onOpenSettings,
}: ModelOptionsMenuProps) {
  const model = getModelDescriptor(runtime, options)
  const providers = getRuntimeProviders(runtime)
  if (!model) {
    return (
      <Button
        aria-label="Model catalog unavailable"
        className="model-menu-trigger h-8 min-h-8 min-w-0 max-w-[210px] gap-1 overflow-hidden rounded-md border-0 bg-transparent px-2 text-sm font-medium text-ellipsis whitespace-nowrap text-[var(--text-tertiary)] shadow-none max-[820px]:max-w-[150px] max-[820px]:text-[11px]"
        disabled
        type="button"
        variant="ghost"
      >
        Model unavailable
      </Button>
    )
  }
  const modelLabel = model.label
  const effortLabel = model.capabilities.reasoning ? getEffortLabel(options) : 'Off'
  const effortOptions = [
    { label: 'Off', value: 'off' },
    ...(model.capabilities.reasoning ? model.capabilities.reasoningEfforts : [])
      .filter((effort) => effort !== 'none')
      .map((effort) => ({ label: formatReasoningEffort(effort), value: effort })),
  ]

  function setModel(nextModel: ModelDescriptor) {
    onChange(selectModelOptions(options, nextModel))
    onOpenChange(false)
  }

  function setEffort(value: string) {
    onChange({
      ...options,
      reasoningEnabled: value !== 'off',
      reasoningEffort: value === 'off' ? options.reasoningEffort : value,
    })
    onOpenChange(false)
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger
        aria-label={`Model and Effort: ${modelLabel}, ${effortLabel}`}
        disabled={disabled}
        render={
          <Button
            className="model-menu-trigger h-8 min-h-8 min-w-0 max-w-[210px] gap-1 overflow-hidden rounded-md border-0 bg-transparent px-2 text-sm font-medium text-ellipsis whitespace-nowrap text-[var(--text-secondary)] shadow-none hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] data-[popup-open]:bg-[var(--surface-muted)] data-[popup-open]:text-[var(--text-primary)] max-[820px]:max-w-[150px] max-[820px]:text-[11px]"
            variant="ghost"
          />
        }
      >
        <span>{modelLabel}</span>
        <span aria-hidden="true" className="model-trigger-divider text-[var(--text-tertiary)]">·</span>
        <span>{effortLabel}</span>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner align="end" alignOffset={73} className="menu-positioner" side="top" sideOffset={49}>
          <DropdownMenuContent className="dropdown-menu model-options-menu min-w-[284px] -translate-x-[32px] translate-y-[32px] p-1.5 dark:min-w-[276px] dark:translate-x-0 dark:translate-y-0 max-[820px]:min-w-[252px] max-[820px]:translate-0">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="dropdown-menu-item submenu-trigger grid min-h-9 grid-cols-[76px_minmax(0,1fr)_auto] gap-2 px-2.5 py-1 text-sm max-[820px]:text-[13px]" nativeButton render={<button aria-label="Select Model" type="button" />}>
                <span className="submenu-label">Model</span>
                <span className="submenu-value overflow-hidden text-right text-ellipsis whitespace-nowrap text-[var(--text-tertiary)]">{modelLabel}</span>
                <ChevronRightIcon aria-hidden="true" size={15} />
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner align="start" alignOffset={-6} className="menu-positioner" side="right" sideOffset={7}>
                  <DropdownMenuContent className="dropdown-menu model-submenu min-w-[240px] p-1.5 max-[820px]:min-w-[220px]">
                    {providers.map((provider, providerIndex) => (
                      <div className="model-provider-group" key={provider.id}>
                        {providerIndex > 0 ? <DropdownMenuSeparator className="model-provider-separator mx-1 my-1.5" /> : null}
                        <div className="submenu-heading flex min-h-7 items-center px-2.5 text-xs font-medium text-[var(--text-secondary)]">
                          {provider.label}{provider.configured ? '' : ' · 未配置'}
                        </div>
                        {provider.models.map((item) => {
                          const selected = item.id === model.id && item.provider === model.provider
                          return (
                            <DropdownMenuItem
                              className={cn(
                                'dropdown-menu-item option-item min-h-9 justify-between py-1 pr-2.5 pl-[18px] text-sm text-[var(--text-primary)] data-disabled:opacity-40 max-[820px]:text-[13px]',
                                selected && 'selected bg-[var(--surface-muted)] font-medium',
                              )}
                              disabled={!provider.configured || item.disabled}
                              key={item.id}
                              nativeButton
                              onClick={() => setModel(item)}
                              render={<button aria-label={`Select ${item.label}`} type="button" />}
                            >
                              <span>{item.label}</span>
                              {selected ? <CheckIcon aria-hidden="true" size={15} /> : null}
                            </DropdownMenuItem>
                          )
                        })}
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenuPositioner>
              </DropdownMenuPortal>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="dropdown-menu-item submenu-trigger grid min-h-9 grid-cols-[76px_minmax(0,1fr)_auto] gap-2 px-2.5 py-1 text-sm max-[820px]:text-[13px]" nativeButton render={<button aria-label="Select Effort" type="button" />}>
                <span className="submenu-label">Effort</span>
                <span className="submenu-value overflow-hidden text-right text-ellipsis whitespace-nowrap text-[var(--text-tertiary)]">{effortLabel}</span>
                <ChevronRightIcon aria-hidden="true" size={15} />
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner align="start" alignOffset={-119} className="menu-positioner" side="right" sideOffset={7}>
                  <DropdownMenuContent className="dropdown-menu effort-submenu min-w-[180px] p-1.5 max-[820px]:min-w-[168px]">
                    <div className="submenu-heading px-2.5 pt-1.5 pb-1 text-xs text-[var(--text-tertiary)]">Effort</div>
                    {effortOptions.map((effort) => {
                      const selected = effort.label === effortLabel
                      return (
                        <DropdownMenuItem
                          className={cn(
                            'dropdown-menu-item option-item min-h-8 justify-between px-2.5 py-1.5 text-sm text-[var(--text-primary)] max-[820px]:text-[13px]',
                            selected && 'selected bg-[var(--surface-muted)] font-medium',
                          )}
                          key={effort.value}
                          nativeButton
                          onClick={() => setEffort(effort.value)}
                          render={<button aria-label={`Select Effort ${effort.label}`} type="button" />}
                        >
                          <span>{effort.label}</span>
                          {selected ? <CheckIcon aria-hidden="true" size={15} /> : null}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenuPositioner>
              </DropdownMenuPortal>
            </DropdownMenuSub>

            <DropdownMenuSeparator className="my-1.5" />
            <DropdownMenuItem
              className="dropdown-menu-item min-h-9 px-2.5 py-1 text-sm max-[820px]:text-[13px]"
              nativeButton
              onClick={() => { onOpenChange(false); onOpenSettings() }}
              render={<button aria-label="More Settings" type="button" />}
            >
              <SlidersHorizontalIcon aria-hidden="true" size={15} />
              <span>More Settings</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenu>
  )
}
