import { ArrowDownIcon, ChevronDownIcon, LogOutIcon, MoonIcon, SunIcon } from 'lucide-react'

import { AppActionsMenu } from '#components/AppActionsMenu'
import { AppDialog } from '#components/AppDialog'
import { ChatComposer } from '#components/ChatComposer'
import { ChatSidebar } from '#components/ChatSidebar'
import { ContextDebugModal } from '#components/ContextDebugModal'
import { ConversationSummaryModal } from '#components/ConversationSummaryModal'
import { EmptyState } from '#components/EmptyState'
import { MessageList } from '#components/MessageList'
import { ModelSettingsModal } from '#components/ModelSettingsModal'
import { PromptTemplateModal } from '#components/PromptTemplateModal'
import { Button } from '#components/ui/button'
import { useChatAppController } from '#hooks/useChatAppController'
import { useAuth } from '#hooks/useAuth'

export function App() {
  const controller = useChatAppController()
  const auth = useAuth()

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
      className="app-shell grid h-dvh w-screen grid-cols-[clamp(302px,calc(100vw-1284px),318px)_minmax(0,1fr)] overflow-hidden bg-[var(--app-bg)] text-sm text-[var(--text-primary)] max-[820px]:grid-cols-[minmax(0,1fr)] max-[820px]:grid-rows-[178px_minmax(0,1fr)]"
      data-theme={controller.theme}
    >
      <ChatSidebar
        conversations={controller.visibleConversations}
        currentConversationId={controller.currentConversationId}
        isResponding={controller.isResponding}
        isSearching={controller.isConversationSearching}
        isStopping={controller.isStopping}
        isLoggingOut={auth.loggingOut}
        onClearConversation={() => void controller.handleClearCurrentConversation()}
        onDeleteConversation={(id) => void controller.handleDeleteConversation(id)}
        onExportAllConversations={() => void controller.handleExportAllConversations()}
        onExportConversation={(conversation) => void controller.handleExportConversation(conversation)}
        onImportConversations={controller.openImportPicker}
        onLogout={() => void auth.logout()}
        onNewChat={() => void controller.startNewChat()}
        onOpenConversationMenu={(id) =>
          controller.setActiveTopMenu(id ? { kind: 'conversation', id } : null)
        }
        onRenameConversation={(conversation) => void controller.handleRenameConversation(conversation)}
        onSelectConversation={(id) => void controller.selectConversation(id)}
        onUpdateSearchQuery={(query) => void controller.searchConversations(query)}
        onUserMenuOpenChange={(open) => controller.setMenuOpen({ kind: 'user' }, open)}
        showLogout={auth.status === 'authenticated'}
        openConversationMenuId={openConversationMenuId}
        operation={controller.sidebarOperation}
        profile={controller.runtimeInfo?.profile}
        searchError={controller.conversationSearchError}
        searchQuery={controller.conversationSearchQuery}
        userMenuOpen={userMenuOpen}
      />

      <main className="chat-main grid min-h-0 min-w-0 grid-rows-[70px_minmax(0,1fr)_auto] bg-[var(--app-bg)] max-[820px]:grid-rows-[48px_minmax(0,1fr)_auto]">
        <header className="chat-header flex w-full min-w-0 items-center justify-between pr-[22px] pl-[30px] max-[820px]:pr-[10px] max-[820px]:pl-4">
          <h2 className="m-0 flex max-w-[70%] min-w-0 items-center gap-[5px] overflow-hidden text-base leading-[1.2] font-semibold text-ellipsis whitespace-nowrap text-[var(--text-heading)] max-[820px]:text-sm">
            <span>{controller.currentConversationTitle}</span>
            <ChevronDownIcon aria-hidden="true" size={14} />
          </h2>
          <div className="chat-header-actions flex items-center gap-0.5">
            {auth.status === 'authenticated' ? (
              <Button
                aria-label="退出登录"
                className="header-icon-btn hidden size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] max-[820px]:inline-flex"
                disabled={controller.isResponding || controller.isStopping || auth.loggingOut}
                onClick={() => void auth.logout()}
                size="icon"
                type="button"
                variant="ghost"
              >
                <LogOutIcon aria-hidden="true" size={18} />
                <span className="sr-only">退出登录</span>
              </Button>
            ) : null}
            <Button
              aria-label={controller.themeToggleLabel}
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
              canGenerateSummary={controller.canGenerateSummary}
              canPreviewContext={controller.canPreviewContext}
              disabled={
                controller.isStopping ||
                controller.isModelOptionsSaving ||
                controller.isConversationTransitioning
              }
              isContextPreviewLoading={controller.isContextPreviewLoading}
              onOpenChange={(open) => controller.setMenuOpen({ kind: 'app' }, open)}
              onOpenSettings={() => controller.setIsModelSettingsOpen(true)}
              onOpenSummary={() => {
                if (controller.canGenerateSummary) controller.setIsSummaryOpen(true)
              }}
              onOpenTemplates={() => controller.setIsTemplateModalOpen(true)}
              onPreviewContext={() => void controller.openContextPreview()}
              open={openAppMenu}
            />
          </div>
        </header>

        <div className="chat-scroll-shell relative min-h-0">
          <section
            className="chat-scroll h-full min-h-0 overflow-y-auto overscroll-contain px-7 pt-5 pb-[34px] max-[820px]:px-3.5 max-[820px]:pt-3.5 max-[820px]:pb-5"
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
          canGenerateSummary={controller.canGenerateSummary}
          canPreviewContext={controller.canPreviewContext}
          canSubmit={controller.canSubmit}
          disabled={composerDisabled}
          isContextPreviewLoading={controller.isContextPreviewLoading}
          isResponding={controller.isResponding}
          isStopping={controller.isStopping}
          modelMenuOpen={modelMenuOpen}
          modelOptions={controller.modelOptions}
          runtime={controller.runtimeInfo}
          onChange={controller.setInput}
          onModelMenuOpenChange={(open) => controller.setMenuOpen({ kind: 'model' }, open)}
          onModelOptionsChange={controller.setModelOptions}
          onOpenSettings={() => controller.setIsModelSettingsOpen(true)}
          onOpenSummary={() => {
            if (controller.canGenerateSummary) controller.setIsSummaryOpen(true)
          }}
          onOpenTemplates={() => controller.setIsTemplateModalOpen(true)}
          onPreviewContext={() => void controller.openContextPreview()}
          onStop={() => void controller.stopGenerating()}
          onSubmit={() => void controller.handleSubmit()}
          onToolsMenuOpenChange={(open) => controller.setMenuOpen({ kind: 'tools' }, open)}
          placeholder="Ask AI"
          ref={controller.composerRef}
          toolsMenuOpen={toolsMenuOpen}
          value={controller.input}
        />
      </main>

      <AppDialog
        dialog={controller.dialog}
        key={`${controller.dialog.open}-${controller.dialog.title}`}
        onCancel={() => controller.closeDialog(null)}
        onConfirm={(value) => controller.closeDialog(value)}
      />
      <ContextDebugModal
        context={controller.contextPreview}
        onClose={() => controller.setIsContextPreviewOpen(false)}
        open={controller.isContextPreviewOpen}
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
        accept="application/json,.json"
        className="visually-hidden sr-only"
        disabled={Boolean(controller.sidebarOperation)}
        onChange={(event) => void controller.handleImportFile(event)}
        ref={controller.importInputRef}
        type="file"
      />
    </div>
  )
}
