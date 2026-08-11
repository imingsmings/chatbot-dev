import {
  BracesIcon,
  EllipsisIcon,
  FileTextIcon,
  SlidersHorizontalIcon,
  TextCursorInputIcon,
} from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu'
import { Button } from '#components/ui/button'

type AppActionsMenuProps = {
  canGenerateSummary: boolean
  canPreviewContext: boolean
  disabled: boolean
  isContextPreviewLoading: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
  onOpenSummary: () => void
  onOpenTemplates: () => void
  onPreviewContext: () => void
}

export function AppActionsMenu(props: AppActionsMenuProps) {
  return (
    <DropdownMenu onOpenChange={props.onOpenChange} open={props.open}>
      <DropdownMenuTrigger
        aria-label="更多操作"
        disabled={props.disabled}
        render={
          <Button
            className="header-icon-btn size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            size="icon"
            variant="ghost"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" size={19} />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner align="end" className="menu-positioner" sideOffset={6}>
          <DropdownMenuContent className="dropdown-menu app-actions-menu">
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
              nativeButton
              onClick={props.onOpenTemplates}
              render={<button aria-label="模板" type="button" />}
            >
              <TextCursorInputIcon aria-hidden="true" size={15} />
              <span>模板</span>
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
            <DropdownMenuItem
              className="dropdown-menu-item"
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
  )
}
