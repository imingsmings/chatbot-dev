import {
  FileDownIcon,
  FileUpIcon,
  LogOutIcon,
  SquarePenIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
  SunMoonIcon,
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
  onClose: () => void
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
  themeToggleLabel: string
  onToggleTheme: () => void
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
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>AI 助手</h1>
        <div className="flex items-center">
        <Button
          aria-busy={isOperation('create') || undefined}
          aria-label="新建会话"
          tooltip="新建会话"
          className="new-chat-btn size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          disabled={sidebarBusy || props.isStopping}
          onClick={props.onNewChat}
          size="icon"
          type="button"
          variant="ghost"
        >
            <SquarePenIcon aria-hidden="true" size={18} />
          <span className="sr-only">{isOperation('create') ? '新建中...' : '新建'}</span>
        </Button>
        <Button aria-label="关闭会话列表" className="sidebar-close" onClick={props.onClose} size="icon" variant="ghost"><XIcon aria-hidden="true" size={18} /></Button>
        </div>
      </div>

      <label className="conversation-search" htmlFor="conversation-search-input">
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-2.5 z-10" size={16} />
        <Input
          className="conversation-search-input"
          id="conversation-search-input"
          disabled={sidebarBusy || props.isStopping}
          onChange={(event) => props.onUpdateSearchQuery(event.target.value)}
          placeholder="搜索会话"
          type="search"
          value={props.searchQuery}
        />
      </label>
      {props.searchError ? (
        <p className="conversation-search-status error -mt-[5px] mx-2.5 mb-[7px] text-[11px] text-[var(--danger)]">{props.searchError}</p>
      ) : props.isSearching ? (
        <p className="conversation-search-status -mt-[5px] mx-2.5 mb-[7px] text-[11px] text-[var(--text-secondary)]">搜索中...</p>
      ) : null}

      <nav aria-label="会话" className="conversation-panel">
        {props.conversations.length === 0 ? (
          <div className="empty-sidebar-state px-2.5 py-4 text-xs text-[var(--text-tertiary)]">
            {props.searchQuery.trim() ? '无匹配会话' : '暂无会话'}
          </div>
        ) : null}
        {groups.map((group) => (
          <section className="conversation-group" key={group.label}>
            <p className="section-label">{group.label}</p>
            {group.conversations.map((conversation) => {
              const active = conversation.id === props.currentConversationId
              return (
                <div
                  className={cn(
                    'conversation-item-shell group',
                    active &&
                      'active bg-[var(--surface-hover)] before:absolute before:left-0 before:h-[22px] before:w-[3px] before:rounded-r before:bg-[var(--success)]',
                  )}
                  key={conversation.id}
                >
                  <Button
                    aria-busy={isOperation('select', conversation.id) || undefined}
                    aria-current={active ? 'page' : undefined}
                    aria-description={`${conversation.messageCount} 条消息`}
                    className="conversation-item"
                    disabled={sidebarBusy || props.isStopping}
                    onClick={() => props.onSelectConversation(conversation.id)}
                    type="button"
                    variant="ghost"
                  >
                    <span className="conversation-title w-full overflow-hidden text-sm leading-[1.25] font-medium text-ellipsis whitespace-nowrap max-[820px]:text-[13px]">{conversation.title}</span>
                    {isOperation('select', conversation.id) ? <span className="conversation-meta">加载中...</span> : null}
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

      <div className="sidebar-footer">
        <DropdownMenu onOpenChange={props.onUserMenuOpenChange} open={props.userMenuOpen}>
          <div className="user-profile-row">
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
              {props.profile?.name || '本地用户'}
            </span>
            <DropdownMenuTrigger aria-busy={sidebarBusy || undefined} aria-label={isOperation('import') ? '导入中...' : isOperation('export-all') ? '导出中...' : '用户设置'} disabled={sidebarBusy} render={<Button className="user-menu-trigger" tooltip="数据与设置" size="icon" variant="ghost" />}>
              <SettingsIcon aria-hidden="true" size={18} />
            </DropdownMenuTrigger>
          </div>
          <DropdownMenuPortal>
            <DropdownMenuPositioner align="start" className="menu-positioner" side="top" sideOffset={6}>
              <DropdownMenuContent className="dropdown-menu sidebar-user-menu">
                <DropdownMenuItem nativeButton onClick={props.onToggleTheme} render={<button aria-label={props.themeToggleLabel} type="button" />}>
                  <SunMoonIcon aria-hidden="true" size={16} /><span>{props.themeToggleLabel}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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
                {props.showLogout ? <DropdownMenuSeparator className="dropdown-menu-separator" /> : null}
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
              </DropdownMenuContent>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>
    </aside>
  )
}
