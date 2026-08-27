import {
  ChevronDownIcon,
  FileDownIcon,
  FileUpIcon,
  LogOutIcon,
  MessageSquarePlusIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react'
import { useMemo } from 'react'

import { ConversationActionsMenu } from '#components/ConversationActionsMenu'
import { Button } from '#components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu'
import { Input } from '#components/ui/input'
import { cn } from '#lib/utils'
import type {
  ConversationSearchMatchLocation,
  ConversationSearchResult,
  ConversationSummary,
  RuntimeInfo,
  SidebarOperation,
} from '#types/chat'

type SidebarConversation = ConversationSummary | ConversationSearchResult
type ConversationGroup = { label: string; conversations: SidebarConversation[] }

type ChatSidebarProps = {
  conversations: SidebarConversation[]
  currentConversationId: string | null
  isResponding: boolean
  isSearching: boolean
  isStopping: boolean
  isLoggingOut: boolean
  openConversationMenuId: string | null
  operation: SidebarOperation | null
  profile?: RuntimeInfo['profile']
  searchError: string | null
  searchQuery: string
  userMenuOpen: boolean
  onClearConversation: () => void
  onDeleteConversation: (id: string) => void
  onExportAllConversations: () => void
  onExportConversation: (conversation: ConversationSummary) => void
  onImportConversations: () => void
  onLogout: () => void
  onNewChat: () => void
  onOpenConversationMenu: (id: string | null) => void
  onRenameConversation: (conversation: ConversationSummary) => void
  onSelectConversation: (id: string) => void
  onUpdateSearchQuery: (query: string) => void
  onUserMenuOpenChange: (open: boolean) => void
  showLogout: boolean
}

function getMatchLabel(location: ConversationSearchMatchLocation) {
  return location === 'title' ? '标题匹配' : '消息匹配'
}

function getDateBucket(value: string) {
  const date = new Date(value)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const timestamp = date.getTime()
  if (timestamp >= startToday) return '今天'
  if (timestamp >= startToday - 86_400_000) return '昨天'
  return '更早'
}

function groupConversations(conversations: SidebarConversation[]): ConversationGroup[] {
  const buckets = new Map<string, SidebarConversation[]>([
    ['今天', []],
    ['昨天', []],
    ['更早', []],
  ])

  for (const conversation of conversations) {
    buckets.get(getDateBucket(conversation.updatedAt))?.push(conversation)
  }

  return [...buckets.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, conversations: items }))
}

export function ChatSidebar(props: ChatSidebarProps) {
  const sidebarBusy = Boolean(props.operation)
  const groups = useMemo(() => groupConversations(props.conversations), [props.conversations])

  function isOperation(type: SidebarOperation['type'], conversationId?: string) {
    return (
      props.operation?.type === type &&
      (!conversationId || props.operation.conversationId === conversationId)
    )
  }

  return (
    <aside className="sidebar flex min-h-0 min-w-0 flex-col border-r border-[var(--border-soft)] bg-[var(--sidebar-bg)] px-4 pt-[26px] pb-3 max-[820px]:border-r-0 max-[820px]:border-b max-[820px]:px-2 max-[820px]:pt-2 max-[820px]:pb-[7px]">
      <div className="sidebar-header flex min-h-[50px] items-center justify-between px-1.5 pb-2 max-[820px]:min-h-[34px] max-[820px]:pr-[3px] max-[820px]:pb-1 max-[820px]:pl-2">
        <h1 className="m-0 text-xl leading-[1.2] font-semibold text-[var(--text-heading)] max-[820px]:text-base">AI 助手</h1>
        <Button
          aria-busy={isOperation('create') || undefined}
          aria-label="新建会话"
          className="new-chat-btn size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          disabled={sidebarBusy || props.isStopping}
          onClick={props.onNewChat}
          size="icon"
          type="button"
          variant="ghost"
        >
          <MessageSquarePlusIcon aria-hidden="true" size={18} />
          <span className="sr-only">{isOperation('create') ? '新建中...' : '新建'}</span>
        </Button>
      </div>

      <label className="conversation-search relative mt-0.5 mb-3.5 flex h-[46px] shrink-0 items-center text-[var(--text-tertiary)] max-[820px]:mb-[5px] max-[820px]:h-8" htmlFor="conversation-search-input">
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-2.5 z-10" size={16} />
        <Input
          className="conversation-search-input h-[42px] rounded-[7px] border-transparent bg-[var(--surface-muted)] pr-12 pl-[39px] text-sm text-[var(--text-primary)] focus-visible:border-[var(--border-strong)] focus-visible:bg-[var(--surface)] focus-visible:ring-0 max-[820px]:h-8 max-[820px]:pr-[42px] max-[820px]:pl-[34px] max-[820px]:text-[13px]"
          id="conversation-search-input"
          disabled={sidebarBusy || props.isStopping}
          onChange={(event) => props.onUpdateSearchQuery(event.target.value)}
          placeholder="搜索会话"
          type="search"
          value={props.searchQuery}
        />
        <kbd aria-hidden="true" className="absolute right-2 border-0 font-[inherit] text-sm text-[var(--text-tertiary)] max-[820px]:text-[11px]">⌘K</kbd>
      </label>
      {props.searchError ? (
        <p className="conversation-search-status error -mt-[5px] mx-2.5 mb-[7px] text-[11px] text-[var(--danger)]">{props.searchError}</p>
      ) : props.isSearching ? (
        <p className="conversation-search-status -mt-[5px] mx-2.5 mb-[7px] text-[11px] text-[var(--text-secondary)]">搜索中...</p>
      ) : null}

      <nav aria-label="会话" className="conversation-panel min-h-0 flex-1 overflow-y-auto max-[820px]:flex max-[820px]:gap-1.5 max-[820px]:overflow-x-auto max-[820px]:overflow-y-hidden">
        {props.conversations.length === 0 ? (
          <div className="empty-sidebar-state px-2.5 py-4 text-xs text-[var(--text-tertiary)]">
            {props.searchQuery.trim() ? '无匹配会话' : '暂无会话'}
          </div>
        ) : null}
        {groups.map((group) => (
          <section className="conversation-group not-first:mt-4 max-[820px]:contents" key={group.label}>
            <p className="section-label m-0 px-0.5 pt-3 pb-[7px] text-sm font-semibold text-[var(--text-tertiary)] max-[820px]:hidden">{group.label}</p>
            {group.conversations.map((conversation) => {
              const active = conversation.id === props.currentConversationId
              return (
                <div
                  className={cn(
                    'conversation-item-shell group relative my-px grid min-h-[42px] grid-cols-[minmax(0,1fr)_30px] items-center rounded-[7px] pr-[3px] pl-[9px] hover:bg-[var(--surface-hover)] focus-within:bg-[var(--surface-hover)] max-[820px]:min-h-[34px] max-[820px]:w-[clamp(205px,58vw,230px)] max-[820px]:shrink-0 max-[820px]:pl-[7px]',
                    active &&
                      'active bg-[var(--surface-hover)] before:absolute before:left-0 before:h-[22px] before:w-[3px] before:rounded-r before:bg-[var(--success)]',
                  )}
                  key={conversation.id}
                >
                  <Button
                    aria-busy={isOperation('select', conversation.id) || undefined}
                    className="conversation-item h-auto min-w-0 flex-col items-start gap-0.5 rounded-none bg-transparent px-[5px] py-[3px] text-left text-[var(--text-primary)] hover:bg-transparent max-[820px]:px-[5px] max-[820px]:py-1"
                    disabled={sidebarBusy || props.isStopping}
                    onClick={() => props.onSelectConversation(conversation.id)}
                    type="button"
                    variant="ghost"
                  >
                    <span className="conversation-title w-full overflow-hidden text-sm leading-[1.25] font-medium text-ellipsis whitespace-nowrap max-[820px]:text-[13px]">{conversation.title}</span>
                    <span className={cn('conversation-meta max-w-full overflow-hidden text-[11px] leading-[1.25] text-ellipsis whitespace-nowrap text-[var(--text-tertiary)] max-[820px]:text-[10px]', !active && 'hidden')}>
                      {isOperation('select', conversation.id)
                        ? '加载中...'
                        : `${conversation.messageCount} 条消息`}
                    </span>
                    {'matchedIn' in conversation ? (
                      <span className="conversation-match max-w-full overflow-hidden text-[11px] leading-[1.25] text-ellipsis whitespace-nowrap text-[var(--text-tertiary)] max-[820px]:text-[10px]">{getMatchLabel(conversation.matchedIn)}</span>
                    ) : null}
                    {'snippet' in conversation && conversation.snippet ? (
                      <span className="conversation-snippet line-clamp-2 max-w-full text-[11px] leading-[1.25] text-[var(--text-tertiary)] max-[820px]:text-[10px]">{conversation.snippet}</span>
                    ) : null}
                  </Button>
                  <ConversationActionsMenu
                    conversation={conversation}
                    disabled={sidebarBusy || props.isStopping}
                    isResponding={props.isResponding}
                    onDelete={props.onDeleteConversation}
                    onExport={props.onExportConversation}
                    onOpenChange={(open) => props.onOpenConversationMenu(open ? conversation.id : null)}
                    onRename={props.onRenameConversation}
                    open={props.openConversationMenuId === conversation.id}
                    operation={props.operation}
                  />
                </div>
              )
            })}
          </section>
        ))}
      </nav>

      <div className="sidebar-footer shrink-0 border-t border-[var(--border-soft)] pt-1.5 max-[820px]:hidden">
        <DropdownMenu onOpenChange={props.onUserMenuOpenChange} open={props.userMenuOpen}>
          <DropdownMenuTrigger
            aria-busy={sidebarBusy || undefined}
            aria-label={
              isOperation('import')
                ? '导入中...'
                : isOperation('export-all')
                  ? '导出中...'
                  : isOperation('clear')
                    ? '清空中...'
                  : '用户设置'
            }
            className="user-menu-trigger grid h-11 w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[7px] border-0 bg-transparent px-1.5 text-left text-[var(--text-primary)] hover:bg-[var(--surface-hover)] data-[popup-open]:bg-[var(--surface-hover)]"
            disabled={sidebarBusy}
          >
            {props.profile?.avatarUrl ? (
              <img
                alt={`${props.profile.name} 的头像`}
                className="user-avatar size-8 rounded-full bg-white object-contain"
                src={props.profile.avatarUrl}
              />
            ) : (
              <span aria-hidden="true" className="user-avatar grid size-8 place-items-center rounded-full bg-[var(--surface-muted)] text-[13px] font-semibold text-[var(--text-secondary)]">
                {props.profile?.name?.slice(0, 1) || 'U'}
              </span>
            )}
            <span className="user-name min-w-0 overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap">
              {props.profile?.name || 'User'}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className={cn('text-[var(--text-tertiary)] transition-transform duration-150 motion-reduce:transition-none', props.userMenuOpen && 'rotate-180')}
              size={15}
            />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner align="start" className="menu-positioner" side="top" sideOffset={6}>
              <DropdownMenuContent className="dropdown-menu sidebar-user-menu">
                <DropdownMenuItem
                  className="dropdown-menu-item"
                  disabled={sidebarBusy || props.isResponding || props.isStopping}
                  nativeButton
                  onClick={props.onImportConversations}
                  render={<button aria-label="导入 JSON/ZIP" type="button" />}
                >
                  <FileUpIcon aria-hidden="true" size={15} />
                  <span>{isOperation('import') ? '导入中...' : '导入 JSON/ZIP'}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  aria-busy={isOperation('export-all') || undefined}
                  className="dropdown-menu-item"
                  closeOnClick={false}
                  disabled={sidebarBusy || props.isResponding || props.isStopping}
                  nativeButton
                  onClick={props.onExportAllConversations}
                  render={<button aria-label="导出全部 ZIP" type="button" />}
                >
                  <FileDownIcon aria-hidden="true" size={15} />
                  <span>{isOperation('export-all') ? '导出中...' : '导出全部 ZIP'}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="dropdown-menu-separator" />
                {props.showLogout ? (
                  <DropdownMenuItem
                    aria-busy={props.isLoggingOut || undefined}
                    className="dropdown-menu-item"
                    disabled={sidebarBusy || props.isResponding || props.isStopping || props.isLoggingOut}
                    nativeButton
                    onClick={props.onLogout}
                    render={<button aria-label="退出登录" type="button" />}
                  >
                    <LogOutIcon aria-hidden="true" size={15} />
                    <span>{props.isLoggingOut ? '退出中...' : '退出登录'}</span>
                  </DropdownMenuItem>
                ) : null}
                {props.showLogout ? <DropdownMenuSeparator className="dropdown-menu-separator" /> : null}
                <DropdownMenuItem
                  className="dropdown-menu-item danger text-[var(--danger)] data-[highlighted]:bg-[var(--danger-muted)]"
                  disabled={!props.currentConversationId || sidebarBusy || props.isResponding || props.isStopping}
                  nativeButton
                  onClick={props.onClearConversation}
                  render={<button aria-label="清空当前会话" type="button" />}
                >
                  <Trash2Icon aria-hidden="true" size={15} />
                  <span>{isOperation('clear') ? '清空中...' : '清空当前会话'}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>
    </aside>
  )
}
