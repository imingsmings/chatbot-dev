import { DownloadIcon, EllipsisIcon, PencilIcon, Trash2Icon } from 'lucide-react'

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
import type { ConversationSummary, SidebarOperation } from '#types/chat'

type ConversationActionsMenuProps = {
  conversation: ConversationSummary
  disabled: boolean
  isResponding: boolean
  open: boolean
  operation: SidebarOperation | null
  onDelete: (id: string) => void
  onExport: (conversation: ConversationSummary) => void
  onOpenChange: (open: boolean) => void
  onRename: (conversation: ConversationSummary) => void
}

function isOperation(
  operation: SidebarOperation | null,
  type: SidebarOperation['type'],
  conversationId: string,
) {
  return operation?.type === type && operation.conversationId === conversationId
}

export function ConversationActionsMenu({
  conversation,
  disabled,
  isResponding,
  open,
  operation,
  onDelete,
  onExport,
  onOpenChange,
  onRename,
}: ConversationActionsMenuProps) {
  const exporting = isOperation(operation, 'export-one', conversation.id)
  const renaming = isOperation(operation, 'rename', conversation.id)
  const deleting = isOperation(operation, 'delete', conversation.id)
  const busy = exporting || renaming || deleting

  return (
    <DropdownMenu onOpenChange={(nextOpen) => onOpenChange(nextOpen)} open={open}>
      <DropdownMenuTrigger
        aria-busy={busy || undefined}
        aria-label={`“${conversation.title}”会话操作`}
        disabled={disabled}
        render={
          <Button
            className="conversation-menu-trigger size-7 rounded-[7px] text-[var(--text-secondary)] opacity-0 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] group-hover:opacity-100 group-focus-within:opacity-100 group-[.active]:opacity-100 data-[popup-open]:opacity-100 max-[820px]:opacity-100"
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" size={17} />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner align="start" className="menu-positioner" sideOffset={4}>
          <DropdownMenuContent className="dropdown-menu conversation-actions-menu min-w-[142px]">
            <DropdownMenuItem
              aria-busy={exporting || undefined}
              className="dropdown-menu-item conversation-action-btn justify-start"
              closeOnClick={false}
              disabled={disabled || isResponding}
              nativeButton
              onClick={() => onExport(conversation)}
              render={<button aria-label="导出 Markdown" type="button" />}
            >
              <DownloadIcon aria-hidden="true" size={15} />
              <span>{exporting ? '导出中...' : '导出'}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="dropdown-menu-item conversation-action-btn justify-start"
              disabled={disabled}
              nativeButton
              onClick={() => onRename(conversation)}
              render={<button aria-label="重命名" type="button" />}
            >
              <PencilIcon aria-hidden="true" size={15} />
              <span>{renaming ? '保存中...' : '重命名'}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="dropdown-menu-separator" />
            <DropdownMenuItem
              className="dropdown-menu-item conversation-action-btn danger justify-start text-[var(--danger)] data-[highlighted]:bg-[var(--danger-muted)]"
              disabled={disabled || isResponding}
              nativeButton
              onClick={() => onDelete(conversation.id)}
              render={<button aria-label="删除" type="button" />}
            >
              <Trash2Icon aria-hidden="true" size={15} />
              <span>{deleting ? '删除中...' : '删除'}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenu>
  )
}
