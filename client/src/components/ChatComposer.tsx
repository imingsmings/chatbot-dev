import {
  ArrowUpIcon,
  ImagePlusIcon,
  PlusIcon,
  SquareIcon,
  TextCursorInputIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

import { ModelOptionsMenu } from '#components/ModelOptionsMenu'
import { Button } from '#components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu'
import { Textarea } from '#components/ui/textarea'
import { CHAT_CONTENT_COLUMN_CLASS } from '#lib/chatLayout'
import { cn } from '#lib/utils'
import type { ModelRequestOptions, RuntimeInfo } from '#types/chat'
import type { ComposerImageAttachment } from '#hooks/useImageAttachments'
import { getImageModelSupportMessage } from '#utils/modelOptions'

export type ChatComposerHandle = {
  focus: () => void
  resizeComposer: () => void
}

type ChatComposerProps = {
  mobile?: boolean
  canSubmit: boolean
  attachments: ComposerImageAttachment[]
  disabled: boolean
  isResponding: boolean
  isStopping: boolean
  modelMenuOpen: boolean
  effortMenuOpen: boolean
  modelOptions: ModelRequestOptions
  runtime: RuntimeInfo | null
  modelSupportsImages: boolean
  placeholder: string
  toolsMenuOpen: boolean
  value: string
  onChange: (value: string) => void
  onAddFiles: (files: File[]) => void
  onModelMenuOpenChange: (open: boolean) => void
  onEffortMenuOpenChange: (open: boolean) => void
  onModelOptionsChange: (options: ModelRequestOptions) => void
  onOpenTemplates: () => void
  onRemoveAttachment: (clientId: string) => void
  onRetryAttachment: (clientId: string) => void
  onStop: () => void
  onSubmit: () => void
  onToolsMenuOpenChange: (open: boolean) => void
}

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(props, ref) {
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const imageInputRef = useRef<HTMLInputElement>(null)

    function resizeComposer() {
      const element = inputRef.current
      if (!element) return
      element.style.height = 'auto'
      const maxHeight = Number.parseFloat(getComputedStyle(element).maxHeight) || 180
      element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`
    }

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      resizeComposer,
    }))

    useLayoutEffect(() => {
      resizeComposer()
    }, [props.value, props.mobile])

    useLayoutEffect(() => {
      const input = inputRef.current
      if (!input || typeof ResizeObserver === 'undefined') return
      let previousWidth = input.clientWidth
      const observer = new ResizeObserver(() => {
        if (input.clientWidth === previousWidth) return
        previousWidth = input.clientWidth
        resizeComposer()
      })
      observer.observe(input)
      return () => observer.disconnect()
    }, [])

    function submit(event?: FormEvent) {
      event?.preventDefault()
      props.onSubmit()
    }

    function handleInput(event: ChangeEvent<HTMLTextAreaElement>) {
      props.onChange(event.target.value)
      resizeComposer()
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        props.onSubmit()
      }
    }

    function addFiles(files: FileList | null) {
      if (!files?.length || props.disabled) return
      props.onAddFiles([...files])
    }

    function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
      const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
      if (!images.length) return
      event.preventDefault()
      props.onAddFiles(images)
    }

    function handleDrop(event: DragEvent<HTMLTextAreaElement>) {
      event.preventDefault()
      const images = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'))
      if (images.length) props.onAddFiles(images)
    }

    return (
      <form
        className="composer"
        onSubmit={submit}
      >
        <div
          className={cn(
            'composer-inner',
            CHAT_CONTENT_COLUMN_CLASS,
          )}
        >
          {props.attachments.length ? (
            <div aria-label="待发送图片" className="composer-attachments mb-2 flex flex-wrap gap-2">
              {props.attachments.map((item) => (
                <div
                  className="relative w-[108px] overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)]"
                  data-upload-status={item.status}
                  key={item.clientId}
                >
                  <img
                    alt={item.file.name}
                    className="h-[76px] w-full object-cover"
                    src={item.previewUrl}
                  />
                  <div className="flex min-h-8 items-center gap-1 px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                    <span className="min-w-0 flex-1 truncate">
                      {item.status === 'uploading'
                        ? '上传中...'
                        : item.status === 'deleting'
                          ? '删除中...'
                          : item.status === 'error'
                            ? item.error || '上传失败'
                            : item.file.name}
                    </span>
                    {item.status === 'error' ? (
                      <button
                        aria-label={`重试上传 ${item.file.name}`}
                        className="attachment-retry shrink-0"
                        onClick={() => props.onRetryAttachment(item.clientId)}
                        type="button"
                      >
                        <RefreshCwIcon aria-hidden="true" size={12} />
                      </button>
                    ) : null}
                    <button
                      aria-label={`移除图片 ${item.file.name}`}
                      className="attachment-remove shrink-0"
                      disabled={item.status === 'deleting'}
                      onClick={() => props.onRemoveAttachment(item.clientId)}
                      type="button"
                    >
                      <XIcon aria-hidden="true" size={12} />
                    </button>
                  </div>
                </div>
              ))}
              {!props.modelSupportsImages ? (
                <p className="w-full text-xs text-[var(--danger)]">
                  {getImageModelSupportMessage(props.runtime)}
                </p>
              ) : null}
            </div>
          ) : null}
          <Textarea
            aria-label="消息"
            className="composer-input"
            disabled={props.disabled}
            onChange={handleInput}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={props.placeholder}
            ref={inputRef}
            rows={1}
            value={props.value}
          />
          <div className="composer-bottom-row">
            <div className="composer-tools">
              <DropdownMenu onOpenChange={props.onToolsMenuOpenChange} open={props.toolsMenuOpen}>
                <DropdownMenuTrigger
                  aria-label="添加图片"
                  disabled={props.disabled}
                  render={
                    <Button
                      className="composer-plus-btn composer-tool-icon"
                      tooltip="添加图片"
                      size="icon-lg"
                      variant="ghost"
                    />
                  }
                >
                  <PlusIcon aria-hidden="true" size={20} />
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuPositioner align="start" className="menu-positioner" side="top" sideOffset={8}>
                    <DropdownMenuContent className="dropdown-menu composer-tools-menu pr-[13px]">
                      <DropdownMenuItem
                        className="dropdown-menu-item composer-tool-btn"
                        nativeButton
                        onClick={() => imageInputRef.current?.click()}
                        render={<button aria-label="添加图片" type="button" />}
                      >
                        <ImagePlusIcon aria-hidden="true" size={15} />
                        <span>图片</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="dropdown-menu-item mobile-template-item" nativeButton onClick={props.onOpenTemplates} render={<button aria-label="模板" type="button" />}>
                        <TextCursorInputIcon aria-hidden="true" size={16} /><span>模板</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPositioner>
                </DropdownMenuPortal>
              </DropdownMenu>
              <Button aria-label="模板" tooltip="提示词模板" className="composer-tool-icon template-trigger" disabled={props.disabled} onClick={props.onOpenTemplates} size="icon" type="button" variant="ghost">
                <TextCursorInputIcon aria-hidden="true" size={18} />
              </Button>
            </div>

            <div className="composer-primary-actions">
              {!props.mobile ? <ModelOptionsMenu
                disabled={props.disabled}
                onChange={props.onModelOptionsChange}
                onOpenChange={props.onModelMenuOpenChange}
                effortOpen={props.effortMenuOpen}
                onEffortOpenChange={props.onEffortMenuOpenChange}
                open={props.modelMenuOpen}
                options={props.modelOptions}
                runtime={props.runtime}
              /> : null}
              {props.isResponding || props.isStopping ? (
                <Button
                  aria-busy={props.isStopping || undefined}
                  aria-label={props.isStopping ? '正在停止生成' : '停止生成'}
                  className={`send-btn stop-btn size-[34px] rounded-full bg-[var(--text-primary)] text-[var(--app-bg)] hover:brightness-90 disabled:bg-[var(--text-secondary)] disabled:text-[var(--app-bg)] disabled:opacity-70${props.isStopping ? ' stopping [&_svg]:animate-spin' : ''}`}
                  disabled={props.isStopping}
                  onClick={props.onStop}
                  size="icon-lg"
                  type="button"
                  variant="ghost"
                >
                  <SquareIcon aria-hidden="true" size={13} fill="currentColor" />
                  <span className="sr-only">{props.isStopping ? '停止中...' : '停止'}</span>
                </Button>
              ) : (
                <Button
                  aria-label="发送消息"
                  className="send-btn size-[34px] rounded-full bg-[var(--text-primary)] text-[var(--app-bg)] hover:brightness-90 disabled:bg-[var(--text-secondary)] disabled:text-[var(--app-bg)] disabled:opacity-70"
                  disabled={!props.canSubmit}
                  size="icon-lg"
                  type="submit"
                  variant="ghost"
                >
                  <ArrowUpIcon aria-hidden="true" size={15} />
                  <span className="sr-only">发送</span>
                </Button>
              )}
            </div>
          </div>
        </div>
        <input
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          className="sr-only"
          disabled={props.disabled}
          multiple
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ''
          }}
          ref={imageInputRef}
          type="file"
        />
      </form>
    )
  },
)
