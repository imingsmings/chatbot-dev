import { ArrowDownIcon, MenuIcon, SquarePenIcon, PanelRightIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { AppActionsMenu } from '#components/AppActionsMenu'
import { AppDialog } from '#components/AppDialog'
import { ChatComposer } from '#components/ChatComposer'
import { ChatSidebar } from '#components/ChatSidebar'
import { ContextDebugModal } from '#components/ContextDebugModal'
import { ConversationSummaryModal } from '#components/ConversationSummaryModal'
import { EmptyState } from '#components/EmptyState'
import { MessageList } from '#components/MessageList'
import { ModelSettingsModal } from '#components/ModelSettingsModal'
import { MobileModelSheet } from '#components/MobileModelSheet'
import { PromptTemplateModal } from '#components/PromptTemplateModal'
import { Button } from '#components/ui/button'
import { useChatAppController } from '#hooks/useChatAppController'
import { useAuth } from '#hooks/useAuth'
import { useMediaQuery } from '#hooks/useMediaQuery'
import { useMobileViewport } from '#hooks/useMobileViewport'
import { SidePanel } from '#components/SidePanel'
import '../styles/chat-workspace.css'
import '../styles/chat-mobile.css'

export function App() {
  const controller = useChatAppController()
  const auth = useAuth()
  const mobile = useMediaQuery('(max-width: 820px)')
  useMobileViewport(mobile)
  const contextOverlay = useMediaQuery('(max-width: 1100px)')
  const contextTriggerRef = useRef<HTMLButtonElement>(null)
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null)
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const sidebarOpen = mobile ? mobileSidebarOpen : sidebarExpanded
  const closeSidebar = () => setMobileSidebarOpen(false)
  const contextOpen = controller.isContextPreviewOpen
  const isEmpty = controller.messages.length === 0 && controller.sidebarOperation?.type !== 'initialize'

  const openAppMenu = controller.activeTopMenu?.kind === 'app'
  const openConversationMenuId =
    controller.activeTopMenu?.kind === 'conversation' ? controller.activeTopMenu.id : null
  const modelMenuOpen = controller.activeTopMenu?.kind === 'model'
  const toolsMenuOpen = controller.activeTopMenu?.kind === 'tools'
  const userMenuOpen = controller.activeTopMenu?.kind === 'user'
  const composerDisabled =
    controller.isResponding ||
    controller.isStopping ||
    controller.isModelOptionsSaving ||
    controller.isConversationTransitioning ||
    !controller.currentConversationId

  return (
    <div
      className="app-shell"
      data-theme={controller.theme}
      data-sidebar={sidebarOpen && !mobile}
      data-context={contextOpen && !contextOverlay}
    >
      <SidePanel label="会话列表" modal={mobile} open={sidebarOpen} onClose={closeSidebar} side="left" returnFocusRef={sidebarTriggerRef}>
      <ChatSidebar
        conversations={controller.visibleConversations}
        currentConversationId={controller.currentConversationId}
        isResponding={controller.isResponding}
        isSearching={controller.isConversationSearching}
        isStopping={controller.isStopping}
        isLoggingOut={auth.loggingOut}
        onClose={closeSidebar}
        onDeleteConversation={(id) => void controller.handleDeleteConversation(id)}
        onExportAllConversations={() => void controller.handleExportAllConversations()}
        onExportConversation={(conversation) => void controller.handleExportConversation(conversation)}
        onImportConversations={controller.openImportPicker}
        onLogout={() => void auth.logout()}
        onNewChat={() => { closeSidebar(); void controller.startNewChat() }}
        onOpenConversationMenu={(id) =>
          controller.setActiveTopMenu(id ? { kind: 'conversation', id } : null)
        }
        onRenameConversation={(conversation) => void controller.handleRenameConversation(conversation)}
        onSelectConversation={(id) => { closeSidebar(); void controller.selectConversation(id) }}
        onUpdateSearchQuery={(query) => void controller.searchConversations(query)}
        onUserMenuOpenChange={(open) => controller.setMenuOpen({ kind: 'user' }, open)}
        showLogout={auth.status === 'authenticated'}
        themeToggleLabel={controller.themeToggleLabel}
        onToggleTheme={controller.toggleTheme}
        openConversationMenuId={openConversationMenuId}
        operation={controller.sidebarOperation}
        profile={controller.runtimeInfo?.profile}
        searchError={controller.conversationSearchError}
        searchQuery={controller.conversationSearchQuery}
        userMenuOpen={userMenuOpen}
      />
      </SidePanel>

      <main className="chat-main" data-empty={isEmpty}>
        <header className="chat-header">
          <Button ref={sidebarTriggerRef} aria-label={sidebarOpen ? '收起会话列表' : '打开会话列表'} aria-expanded={sidebarOpen} tooltip={sidebarOpen ? '收起会话列表' : '打开会话列表'} className="sidebar-toggle header-icon-btn" onClick={() => mobile ? setMobileSidebarOpen(!mobileSidebarOpen) : setSidebarExpanded(!sidebarExpanded)} size="icon" variant="ghost"><MenuIcon aria-hidden="true" size={18} /></Button>
          <h2 className={mobile ? 'sr-only' : undefined}>
            <span>{controller.currentConversationTitle}</span>
          </h2>
          {mobile ? (
            <MobileModelSheet
              disabled={composerDisabled}
              saving={controller.isModelOptionsSaving}
              open={modelMenuOpen}
              options={controller.modelOptions}
              runtime={controller.runtimeInfo}
              onChange={controller.setModelOptions}
              onOpenChange={(open) => controller.setMenuOpen({ kind: 'model' }, open)}
            />
          ) : null}
          <div className="chat-header-actions flex items-center gap-0.5">
            {mobile || !sidebarExpanded ? <Button aria-label="新建会话" tooltip="新建会话" className="header-new-chat header-icon-btn" disabled={Boolean(controller.sidebarOperation) || controller.isStopping} onClick={() => void controller.startNewChat()} size="icon" variant="ghost"><SquarePenIcon aria-hidden="true" size={18} /></Button> : null}
            {!mobile ? <Button ref={contextTriggerRef} aria-label="上下文" aria-expanded={contextOpen} aria-busy={controller.isContextPreviewLoading || undefined} tooltip="上下文" className="context-toggle header-icon-btn" disabled={!contextOpen && (!controller.canPreviewContext || controller.isContextPreviewLoading)} onClick={() => contextOpen ? controller.setIsContextPreviewOpen(false) : void controller.openContextPreview()} size="icon" variant="ghost"><PanelRightIcon aria-hidden="true" size={18} /></Button> : null}
            <Button
              aria-label={controller.themeToggleLabel}
              tooltip={controller.themeToggleLabel}
              className="header-icon-btn theme-toggle-btn size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              onClick={controller.toggleTheme}
              size="icon"
              type="button"
              variant="ghost"
            >
              {controller.theme === 'dark' ? (
                <SunIcon aria-hidden="true" size={18} />
              ) : (
                <MoonIcon aria-hidden="true" size={18} />
              )}
              <span className="sr-only">{controller.themeToggleLabel}</span>
            </Button>
            <AppActionsMenu
              triggerRef={mobile ? contextTriggerRef : undefined}
              onOpenContext={mobile ? () => void controller.openContextPreview() : undefined}
              canPreviewContext={controller.canPreviewContext}
              contextLoading={controller.isContextPreviewLoading}
              clearing={controller.sidebarOperation?.type === 'clear'}
              canGenerateSummary={controller.canGenerateSummary}
              canClearConversation={Boolean(controller.currentConversationId) && !controller.sidebarOperation && !controller.isResponding && !controller.isStopping}
              disabled={
                controller.isStopping ||
                controller.isModelOptionsSaving ||
                controller.isConversationTransitioning
              }
              onOpenChange={(open) => controller.setMenuOpen({ kind: 'app' }, open)}
              onOpenSettings={() => controller.setIsModelSettingsOpen(true)}
              onOpenSummary={() => {
                if (controller.canGenerateSummary) controller.setIsSummaryOpen(true)
              }}
              onClearConversation={() => void controller.handleClearCurrentConversation()}
              open={openAppMenu}
            />
          </div>
        </header>

        <div className="chat-scroll-shell relative min-h-0">
          <section
            className="chat-scroll"
            ref={controller.chatBoxRef}
          >
            <div className="chat-scroll-content min-h-full" ref={controller.chatContentRef}>
              {controller.sidebarOperation?.type === 'initialize' ? (
                <output
                  aria-live="polite"
                  className="initial-loading-state grid min-h-full place-items-center text-[13px] text-[var(--text-secondary)]"
                >
                  正在加载会话...
                </output>
              ) : controller.messages.length === 0 ? (
                <EmptyState
                  disabled={controller.isConversationTransitioning || controller.isStopping || controller.isModelOptionsSaving}
                  onUseSuggestion={controller.useSuggestion}
                  suggestions={controller.suggestions}
                  title={controller.currentConversationTitle}
                />
              ) : (
                <MessageList
                  copiedMessageId={controller.copiedMessageId}
                  conversationId={controller.currentConversationId!}
                  isResponding={
                    controller.isResponding ||
                    controller.isStopping ||
                    controller.isModelOptionsSaving ||
                    controller.isConversationTransitioning
                  }
                  messages={controller.messages}
                  onCopyMessage={controller.copyMessage}
                  onEditMessage={controller.handleEditMessage}
                  onRegenerateMessage={controller.handleRegenerateMessage}
                  onRetryMessage={controller.retryMessage}
                />
              )}
            </div>
          </section>
          {!controller.isAtBottom && controller.messages.length > 0 ? (
            <Button
              aria-label="滚动到底部"
              className="scroll-to-bottom-btn absolute bottom-4 left-1/2 z-10 size-9 -translate-x-1/2 rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-secondary)] shadow-lg hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] max-[820px]:bottom-3"
              onClick={controller.scrollChatToBottom}
              size="icon"
              type="button"
              variant="outline"
            >
              <ArrowDownIcon aria-hidden="true" size={17} />
              <span className="sr-only">滚动到底部</span>
            </Button>
          ) : null}
        </div>

        <ChatComposer
          mobile={mobile}
          attachments={controller.imageAttachments}
          canSubmit={controller.canSubmit}
          disabled={composerDisabled}
          isResponding={controller.isResponding}
          isStopping={controller.isStopping}
          modelMenuOpen={modelMenuOpen}
          effortMenuOpen={controller.activeTopMenu?.kind === 'effort'}
          modelOptions={controller.modelOptions}
          modelSupportsImages={controller.modelSupportsImages}
          runtime={controller.runtimeInfo}
          onChange={controller.setInput}
          onAddFiles={controller.addImageFiles}
          onModelMenuOpenChange={(open) => controller.setMenuOpen({ kind: 'model' }, open)}
          onEffortMenuOpenChange={(open) => controller.setMenuOpen({ kind: 'effort' }, open)}
          onModelOptionsChange={controller.setModelOptions}
          onOpenTemplates={() => controller.setIsTemplateModalOpen(true)}
          onRemoveAttachment={(clientId) => void controller.removeImageAttachment(clientId)}
          onRetryAttachment={controller.retryImageAttachment}
          onStop={() => void controller.stopGenerating()}
          onSubmit={() => void controller.handleSubmit()}
          onToolsMenuOpenChange={(open) => controller.setMenuOpen({ kind: 'tools' }, open)}
          placeholder={isEmpty ? '询问任何问题' : '继续追问'}
          ref={controller.composerRef}
          toolsMenuOpen={toolsMenuOpen}
          value={controller.input}
        />
      </main>
      <ContextDebugModal
        context={controller.contextPreview}
        modal={contextOverlay}
        returnFocusRef={contextTriggerRef}
        onClose={() => controller.setIsContextPreviewOpen(false)}
        open={contextOpen}
      />

      <AppDialog
        dialog={controller.dialog}
        key={`${controller.dialog.open}-${controller.dialog.title}`}
        onCancel={() => controller.closeDialog(null)}
        onConfirm={(value) => controller.closeDialog(value)}
      />
      <PromptTemplateModal
        onApply={controller.applyPromptTemplate}
        onClose={() => controller.setIsTemplateModalOpen(false)}
        open={controller.isTemplateModalOpen}
      />
      <ModelSettingsModal
        onClose={() => controller.setIsModelSettingsOpen(false)}
        onSave={(options) => {
          void controller.setModelOptions(options).then((saved) => {
            if (saved) controller.setIsModelSettingsOpen(false)
          })
        }}
        open={controller.isModelSettingsOpen}
        options={controller.modelOptions}
        runtime={controller.runtimeInfo}
        saving={controller.isModelOptionsSaving}
      />
      <ConversationSummaryModal
        loading={controller.isSummaryLoading}
        onClose={() => controller.setIsSummaryOpen(false)}
        onGenerate={() => void controller.handleGenerateSummary()}
        open={controller.isSummaryOpen}
        summary={controller.currentConversationSummary}
      />

      <input
        accept="application/zip,.zip,application/json,.json"
        className="visually-hidden sr-only"
        disabled={Boolean(controller.sidebarOperation)}
        onChange={(event) => void controller.handleImportFile(event)}
        ref={controller.importInputRef}
        type="file"
      />
    </div>
  )
}
