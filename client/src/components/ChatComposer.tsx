import {
  ArrowUpIcon,
  BracesIcon,
  FileTextIcon,
  ImagePlusIcon,
  MicIcon,
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

export type ChatComposerHandle = {
  focus: () => void
  resizeComposer: () => void
}

type ChatComposerProps = {
  canGenerateSummary: boolean
  canPreviewContext: boolean
  canSubmit: boolean
  attachments: ComposerImageAttachment[]
  disabled: boolean
  isContextPreviewLoading: boolean
  isResponding: boolean
  isStopping: boolean
  modelMenuOpen: boolean
  modelOptions: ModelRequestOptions
  runtime: RuntimeInfo | null
  modelSupportsImages: boolean
  placeholder: string
  toolsMenuOpen: boolean
  value: string
  onChange: (value: string) => void
  onAddFiles: (files: File[]) => void
  onModelMenuOpenChange: (open: boolean) => void
  onModelOptionsChange: (options: ModelRequestOptions) => void
  onOpenSettings: () => void
  onOpenSummary: () => void
  onOpenTemplates: () => void
  onPreviewContext: () => void
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
      element.style.height = `${Math.min(element.scrollHeight, 180)}px`
    }

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      resizeComposer,
    }))

    useLayoutEffect(() => {
      resizeComposer()
    }, [props.value])

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
        className="composer shrink-0 px-7 pt-1 pb-[41px] dark:pb-[27px] max-[820px]:px-3.5 max-[820px]:pt-0.5 max-[820px]:pb-2.5"
        onSubmit={submit}
      >
        <div
          className={cn(
            'composer-inner flex min-h-[104px] flex-col justify-between rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-raised)] py-3 pr-5 pl-4 shadow-[var(--shadow-composer)] focus-within:border-[color-mix(in_srgb,var(--border-strong)_50%,var(--text-secondary))] dark:min-h-[104px] max-[820px]:min-h-[92px] max-[820px]:rounded-[18px] max-[820px]:py-2 max-[820px]:pr-[9px] max-[820px]:pl-[13px]',
            CHAT_CONTENT_COLUMN_CLASS,
          )}
        >
          {props.attachments.length ? (
            <div aria-label="待发送图片" className="mb-2 flex flex-wrap gap-2">
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
                        className="shrink-0"
                        onClick={() => props.onRetryAttachment(item.clientId)}
                        type="button"
                      >
                        <RefreshCwIcon aria-hidden="true" size={12} />
                      </button>
                    ) : null}
                    <button
                      aria-label={`移除图片 ${item.file.name}`}
                      className="shrink-0"
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
                  当前模型不支持图片，请切换到 DeepSeek V4 Flash Vision Exp。
                </p>
              ) : null}
            </div>
          ) : null}
          <Textarea
            className="max-h-[180px] min-h-6 w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-sm leading-[1.55] text-[var(--text-primary)] shadow-none placeholder:text-[var(--text-tertiary)] focus-visible:border-0 focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent"
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
          <div className="composer-bottom-row flex min-h-10 items-center justify-between gap-3">
            <div className="composer-tools flex items-center">
              <DropdownMenu onOpenChange={props.onToolsMenuOpenChange} open={props.toolsMenuOpen}>
                <DropdownMenuTrigger
                  aria-label="添加和工具"
                  disabled={props.disabled}
                  render={
                    <Button
                      className="composer-plus-btn size-10 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] data-[popup-open]:bg-[var(--surface-muted)] data-[popup-open]:text-[var(--text-primary)] max-[820px]:size-9"
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
                      <DropdownMenuItem
                        className="dropdown-menu-item composer-tool-btn"
                        nativeButton
                        onClick={props.onOpenTemplates}
                        render={<button aria-label="模板" type="button" />}
                      >
                        <TextCursorInputIcon aria-hidden="true" size={15} />
                        <span>模板</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="dropdown-menu-item composer-tool-btn"
                        disabled={!props.canGenerateSummary}
                        nativeButton
                        onClick={props.onOpenSummary}
                        render={<button aria-label="摘要" type="button" />}
                      >
                        <FileTextIcon aria-hidden="true" size={15} />
                        <span>摘要</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="dropdown-menu-item composer-tool-btn"
                        disabled={!props.canPreviewContext || props.isContextPreviewLoading}
                        nativeButton
                        onClick={props.onPreviewContext}
                        render={<button aria-label="上下文" type="button" />}
                      >
                        <BracesIcon aria-hidden="true" size={15} />
                        <span>{props.isContextPreviewLoading ? '加载中' : '上下文'}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPositioner>
                </DropdownMenuPortal>
              </DropdownMenu>
            </div>

            <div className="composer-primary-actions flex items-center gap-4 max-[820px]:gap-[5px]">
              <ModelOptionsMenu
                disabled={props.disabled}
                onChange={props.onModelOptionsChange}
                onOpenChange={props.onModelMenuOpenChange}
                onOpenSettings={props.onOpenSettings}
                open={props.modelMenuOpen}
                options={props.modelOptions}
                runtime={props.runtime}
              />
              <Button
                aria-label="语音输入（暂不可用）"
                className="composer-icon-btn microphone-btn size-[34px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] max-[820px]:hidden"
                disabled
                size="icon"
                type="button"
                variant="ghost"
              >
                <MicIcon aria-hidden="true" size={18} />
              </Button>
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
