import { Tabs } from '@base-ui/react/tabs'
import { ChevronDownIcon, XIcon } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'

import { Button } from '#components/ui/button'
import { SidePanel } from '#components/SidePanel'
import type { ContextPreview } from '#types/chat'
import { formatModelName, formatProviderName, formatReasoningEffort, formatStorageBackend } from '#utils/displayNames'

type ContextDebugModalProps = {
  context: ContextPreview | null
  open: boolean
  modal?: boolean
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

function Values({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="context-values">{rows.map(([label, value]) => (
    <div className="context-debug-stat" key={label}><dt>{label}</dt><dd>{value}</dd></div>
  ))}</dl>
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return <details className="context-disclosure"><summary>{title}<ChevronDownIcon aria-hidden="true" size={16} /></summary>{children}</details>
}

export function ContextDebugModal({ context, open, modal = true, onClose, returnFocusRef }: ContextDebugModalProps) {
  const stats = context?.stats
  const model = context?.model
  return (
    <SidePanel label="上下文" modal={modal} open={open} onClose={onClose} side="right" returnFocusRef={returnFocusRef}>
      <div className="context-debug-modal">
        <header className="context-header">
          <h2>上下文</h2>
          <Button aria-label="关闭上下文" tooltip="关闭上下文" className="close-btn" onClick={onClose} size="icon" variant="ghost"><XIcon aria-hidden="true" size={18} /></Button>
        </header>
        {context && stats && model ? (
          <Tabs.Root className="context-tabs" defaultValue="overview" key={context.conversationId}>
            <Tabs.List aria-label="上下文视图" className="context-tab-list">
              <Tabs.Tab value="overview">概览</Tabs.Tab>
              <Tabs.Tab value="request">原始请求</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel className="context-debug-body" value="overview">
              <section aria-label="本次请求" className="context-section">
                <h3>本次请求</h3>
                <Values rows={[
                  ['模型', model.model ? formatModelName(model.model) : '未配置'],
                  ['思考强度', model.reasoningEnabled ? formatReasoningEffort(model.reasoningEffort) : '关闭'],
                  ['历史消息', `${stats.selectedHistoryMessages}/${stats.totalHistoryMessages}`],
                  ['摘要', stats.summaryIncluded ? '已包含' : stats.summaryDroppedByTokenBudget ? '预算不足，已排除' : '未包含'],
                ]} />
              </section>
              <section aria-label="上下文预算" className="context-section">
                <h3>上下文预算 <span>（估算）</span></h3>
                <meter aria-label="上下文预算使用量" min={0} max={stats.contextWindowTokens} value={Math.min(stats.estimatedTotalTokens, stats.contextWindowTokens)} />
                <Values rows={[
                  ['总量', `${stats.estimatedTotalTokens}/${stats.contextWindowTokens}`],
                  ['输入', `${stats.estimatedInputTokens}/${stats.contextWindowTokens - stats.outputReserveTokens}`],
                  ['输出预留', stats.outputReserveTokens],
                  ['输入剩余', stats.remainingInputTokens],
                ]} />
                <Disclosure title="预算明细">
                  <section aria-label="Token Budget Breakdown">
                    <Values rows={[
                      ['系统', stats.tokenBreakdown.system], ['摘要', stats.tokenBreakdown.summary],
                      ['历史', stats.tokenBreakdown.history], ['当前问题', stats.tokenBreakdown.currentQuestion],
                      ['图片', stats.tokenBreakdown.images], ['工具', stats.tokenBreakdown.tools],
                      ['协议开销', stats.tokenBreakdown.framing], ['工具续调预留', stats.tokenBreakdown.toolContinuationReserve],
                    ]} />
                    <p className="context-estimator">{stats.estimator} · 保守估算，实际用量以服务端返回为准。</p>
                  </section>
                </Disclosure>
              </section>
              <Disclosure title="历史筛选详情">
                <Values rows={[
                  ['摘要已覆盖', stats.summaryCoveredMessages], ['摘要之后', stats.postSummaryMessages],
                  ['已排除的停止消息', stats.excludedStoppedMessages],
                  ['选中范围', stats.selectedHistoryRange ? `${stats.selectedHistoryRange.start}-${stats.selectedHistoryRange.end}` : '无'],
                  ['排除消息', stats.droppedHistoryMessages],
                  ['字符数', `${stats.selectedHistoryChars}/${stats.maxHistoryChars}`],
                  ['预算裁剪消息', stats.tokenDroppedHistoryMessages],
                  ['历史窗口裁剪', stats.legacyDroppedHistoryMessages],
                  ['选中图片', `${stats.selectedImages}/${stats.maxImages}`], ['排除图片', stats.droppedImages],
                  ['图片字节数', stats.selectedImageBytes],
                ]} />
              </Disclosure>
              <Disclosure title="模型参数">
                <Values rows={[
                  ['提供方', formatProviderName(model.provider)], ['模型', model.model ? formatModelName(model.model) : '未配置'],
                  ['流式输出', model.stream ? '开启' : '关闭'], ['工具选择', model.toolChoice === 'auto' ? '自动' : model.toolChoice],
                  ['API Key', model.apiKeyConfigured ? '已配置' : '未配置'],
                  ['存储', formatStorageBackend(model.storageBackend)], ['温度', model.temperature ?? '模型默认'],
                  ['最大输出 Token', model.maxTokens ?? '模型默认'], ['上下文窗口', model.contextWindowTokens],
                ]} />
              </Disclosure>
            </Tabs.Panel>
            <Tabs.Panel className="context-debug-body" value="request">
              <Disclosure title={`发送给模型的消息 · ${context.messages.length}`}>
                <ol className="context-message-list">
                  {context.messages.map((message, index) => (
                    <li className="context-message-item" key={`${index}-${message.role}`}>
                      <span className="context-message-role">{message.role.toUpperCase()}</span>
                      <pre className="context-message-content">{message.content || ''}</pre>
                    </li>
                  ))}
                </ol>
              </Disclosure>
              <Disclosure title={`工具定义 · ${context.tools.count}`}>
                <pre className="context-tools-content">{JSON.stringify(context.tools.definitions, null, 2)}</pre>
              </Disclosure>
            </Tabs.Panel>
          </Tabs.Root>
        ) : <p className="context-empty">暂无上下文数据</p>}
      </div>
    </SidePanel>
  )
}
