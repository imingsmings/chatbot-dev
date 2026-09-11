import {
  EllipsisIcon,
  FileTextIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  LoaderCircleIcon,
  PanelRightIcon,
} from 'lucide-react'
import type { RefObject } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu'
import { Button } from '#components/ui/button'

type AppActionsMenuProps = {
  canGenerateSummary: boolean
  canClearConversation: boolean
  disabled: boolean
  clearing?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
  onOpenSummary: () => void
  onClearConversation: () => void
  onOpenContext?: () => void
  canPreviewContext?: boolean
  contextLoading?: boolean
  triggerRef?: RefObject<HTMLButtonElement | null>
}

export function AppActionsMenu(props: AppActionsMenuProps) {
  return (
    <DropdownMenu onOpenChange={props.onOpenChange} open={props.open}>
      <DropdownMenuTrigger
        aria-label={props.clearing ? '正在清空会话' : '更多操作'}
        aria-busy={props.clearing || undefined}
        disabled={props.disabled || props.clearing}
        render={
          <Button
            ref={props.triggerRef}
            className="header-icon-btn size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            size="icon"
            tooltip="会话操作"
            variant="ghost"
          />
        }
      >
        {props.clearing ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" size={18} /> : <EllipsisIcon aria-hidden="true" size={19} />}
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner align="end" className="menu-positioner" sideOffset={6}>
          <DropdownMenuContent className="dropdown-menu app-actions-menu">
            {props.onOpenContext ? (
              <DropdownMenuItem
                className="dropdown-menu-item context-menu-item"
                disabled={!props.canPreviewContext || props.contextLoading}
                nativeButton
                onClick={props.onOpenContext}
                render={<button aria-label="上下文" type="button" />}
              >
                <PanelRightIcon aria-hidden="true" size={15} />
                <span>{props.contextLoading ? '读取上下文...' : '上下文'}</span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="dropdown-menu-item"
              nativeButton
              onClick={props.onOpenSettings}
              render={<button aria-label="参数" type="button" />}
            >
              <SlidersHorizontalIcon aria-hidden="true" size={15} />
              <span>参数</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="dropdown-menu-item"
              disabled={!props.canGenerateSummary}
              nativeButton
              onClick={props.onOpenSummary}
              render={<button aria-label="摘要" type="button" />}
            >
              <FileTextIcon aria-hidden="true" size={15} />
              <span>摘要</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="dropdown-menu-item text-[var(--danger)] data-[highlighted]:bg-[var(--danger-muted)]"
              disabled={!props.canClearConversation}
              nativeButton
              onClick={props.onClearConversation}
              render={<button aria-label="清空当前会话" type="button" />}
            >
              <Trash2Icon aria-hidden="true" size={15} />
              <span>清空当前会话</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenu>
  )
}
