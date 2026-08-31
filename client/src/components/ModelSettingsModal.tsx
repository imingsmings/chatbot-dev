import { XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '#components/ui/button'
import { DialogClose, DialogContent, DialogRoot, DialogTitle } from '#components/ui/dialog'
import { Input } from '#components/ui/input'
import type { ModelRequestOptions, RuntimeInfo } from '#types/chat'
import { formatReasoningEffort, formatStorageBackend } from '#utils/displayNames'
import {
  getModelDescriptor,
  getRuntimeProviders,
  parseModelSettingsDraft,
} from '#utils/modelOptions'

type ModelSettingsModalProps = {
  saving?: boolean
  open: boolean
  options: ModelRequestOptions
  runtime: RuntimeInfo | null
  onClose: () => void
  onSave: (options: ModelRequestOptions) => void
}

export function ModelSettingsModal({
  saving = false,
  open,
  options,
  runtime,
  onClose,
  onSave,
}: ModelSettingsModalProps) {
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [reasoningEnabled, setReasoningEnabled] = useState(true)
  const [reasoningEffort, setReasoningEffort] = useState('max')
  const [validationError, setValidationError] = useState('')
  const model = getModelDescriptor(runtime, options)
  const providerLabel = getRuntimeProviders(runtime)
    .find((provider) => provider.id === model?.provider)?.label ?? model?.provider

  useEffect(() => {
    if (!open) return
    setTemperature(options.temperature === undefined ? '' : String(options.temperature))
    setMaxTokens(options.maxTokens === undefined ? '' : String(options.maxTokens))
    setReasoningEnabled(options.reasoningEnabled ?? true)
    setReasoningEffort(options.reasoningEffort || 'max')
    setValidationError('')
  }, [open, options])

  function save() {
    if (!model) {
      setValidationError('Model catalog is unavailable. Refresh and try again.')
      return
    }
    try {
      const nextOptions = parseModelSettingsDraft({
        maxTokens,
        reasoningEffort,
        reasoningEnabled,
        temperature,
      }, model)
      setValidationError('')
      onSave({
        ...nextOptions,
        provider: model.provider,
        model: model.id,
      })
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Invalid model parameters')
    }
  }

  return (
    <DialogRoot onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
      <DialogContent aria-busy={saving || undefined} className="settings-modal">
        <header className="modal-header flex shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-[17px] py-[15px]">
          <DialogTitle>Model Parameters</DialogTitle>
          <DialogClose
            aria-label="Close"
            onClick={onClose}
            render={<Button className="close-btn size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" size="icon" variant="ghost" />}
          >
            <XIcon aria-hidden="true" size={18} />
          </DialogClose>
        </header>
        <div className="modal-body settings-modal-body flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-[18px]">
          {!model ? (
            <p className="settings-error m-0 text-sm text-[var(--danger)]" role="alert">
              Model catalog is unavailable. Refresh and try again.
            </p>
          ) : null}
          {runtime ? (
            <dl className="runtime-meta m-0 grid grid-cols-3 gap-2 max-[820px]:grid-cols-1">
              <div className="min-w-0 border-b border-[var(--border-soft)] pb-2"><dt className="text-xs font-semibold text-[var(--text-secondary)]">Provider</dt><dd className="mt-1 mb-0 text-[13px] font-semibold [overflow-wrap:anywhere]">{providerLabel ?? 'Unavailable'}</dd></div>
              <div className="min-w-0 border-b border-[var(--border-soft)] pb-2"><dt className="text-xs font-semibold text-[var(--text-secondary)]">Model</dt><dd className="mt-1 mb-0 text-[13px] font-semibold [overflow-wrap:anywhere]">{model?.label ?? 'Unavailable'}</dd></div>
              <div className="min-w-0 border-b border-[var(--border-soft)] pb-2"><dt className="text-xs font-semibold text-[var(--text-secondary)]">Storage</dt><dd className="mt-1 mb-0 text-[13px] font-semibold [overflow-wrap:anywhere]">{formatStorageBackend(runtime.storageBackend)}</dd></div>
            </dl>
          ) : null}
          {model?.capabilities.temperature ? (
            <label className="settings-field flex flex-col gap-[7px] text-xs font-semibold text-[var(--text-secondary)]" htmlFor="model-temperature">
              <span>Temperature</span>
              <Input
                className="h-auto rounded-[7px] border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-[9px] text-[13px] text-[var(--text-primary)] focus-visible:border-[var(--ring)] focus-visible:ring-0"
                id="model-temperature"
                max="2"
                min="0"
                onChange={(event) => setTemperature(event.target.value)}
                placeholder="Provider Default"
                step="0.1"
                type="number"
                value={temperature}
              />
            </label>
          ) : null}
          {model ? <label className="settings-field flex flex-col gap-[7px] text-xs font-semibold text-[var(--text-secondary)]" htmlFor="model-max-tokens">
            <span>Max Tokens</span>
            <Input
              className="h-auto rounded-[7px] border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-[9px] text-[13px] text-[var(--text-primary)] focus-visible:border-[var(--ring)] focus-visible:ring-0"
              id="model-max-tokens"
              max={model.capabilities.maxOutputTokens}
              min="1"
              onChange={(event) => setMaxTokens(event.target.value)}
              placeholder="Provider Default"
              step="1"
              type="number"
              value={maxTokens}
            />
          </label> : null}
          {model?.capabilities.reasoning ? <label className="settings-toggle flex items-center gap-2 text-[13px]">
            <input
              className="size-4 accent-[var(--text-primary)]"
              checked={reasoningEnabled}
              onChange={(event) => setReasoningEnabled(event.target.checked)}
              type="checkbox"
            />
            <span>Enable Reasoning</span>
          </label> : null}
          {model?.capabilities.reasoning ? <label className="settings-field flex flex-col gap-[7px] text-xs font-semibold text-[var(--text-secondary)]" htmlFor="model-reasoning-effort">
            <span>{providerLabel} Effort</span>
            <select
              className="w-full rounded-[7px] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-[9px] text-[13px] text-[var(--text-primary)] outline-none focus-visible:border-[var(--ring)] focus-visible:ring-0 disabled:opacity-50"
              id="model-reasoning-effort"
              disabled={!reasoningEnabled}
              onChange={(event) => setReasoningEffort(event.target.value)}
              value={reasoningEffort}
            >
              {model.capabilities.reasoningEfforts
                .filter((effort) => effort !== 'none')
                .map((effort) => (
                  <option key={effort} value={effort}>
                    {formatReasoningEffort(effort)}
                  </option>
                ))}
            </select>
          </label> : null}
          {validationError ? <p className="settings-error m-0 text-xs text-[var(--danger)]" role="alert">{validationError}</p> : null}
        </div>
        <footer className="modal-footer flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-soft)] px-[17px] py-[15px]">
          <DialogClose onClick={onClose} render={<Button className="modal-btn secondary h-[34px] rounded-[7px] border-[var(--border-strong)] bg-[var(--surface-raised)] px-3.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-muted)]" variant="outline" />}>Cancel</DialogClose>
          <Button className="modal-btn primary h-[34px] rounded-[7px] bg-[var(--text-primary)] px-3.5 text-xs font-semibold text-[var(--app-bg)] hover:brightness-90" disabled={saving || !model} onClick={save} type="button">{saving ? 'Saving...' : 'Apply'}</Button>
        </footer>
      </DialogContent>
    </DialogRoot>
  )
}
