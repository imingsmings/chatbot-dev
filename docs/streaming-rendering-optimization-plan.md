# 流式渲染平滑度优化方案

状态：设计文档完成，尚未确认实施。

本文把当前 React 客户端的流式渲染优化整理为可分阶段实施、可测量验收和可独立回滚的候选方案。它不是已完成记录，也不代表当前页面已经通过性能实测；文中的瓶颈判断来自 2026-08-13 对当前源码的静态分析，实施前必须先建立同一环境下的自动化基线。

## 1. 直接价值

- 减少模型持续输出时的成段跳字、长回答卡顿和滚动抖动。
- 保持首批可见内容及时出现，同时降低 React 更新、Markdown 全文重算和重复布局读取的频率。
- 让短回答、超长 Markdown、reasoning、工具调用、停止和错误恢复使用同一套可重复性能证据，而不是依赖主观观感。
- 不改变 Provider 接入、应用协议或持久化格式，控制改动范围并保留逐阶段回滚能力。

## 2. 当前实现与静态判断

当前链路保持为：

```text
Provider SSE
  -> server adapter / chat orchestration
  -> application/x-ndjson + X-Chat-Stream-Protocol: 2
  -> readChatStream line parser
  -> useChatStream
  -> conversation reducer
  -> MessageList / MarkdownMessage
  -> auto scroll
```

当前已经具备的保护：

- `readChatStream` 正确缓冲跨网络 chunk 的不完整 NDJSON 行，不把一次 `read()` 当作事件边界。
- Markdown 流式阶段关闭代码高亮，完成后才进行完整高亮。
- `MarkdownMessage` 按累计内容长度使用 160ms、260ms、420ms 三档节流。
- 自动滚动使用 `requestAnimationFrame` 合并同一帧内的滚动请求，用户主动上滚后停止跟随。
- `done`、`error`、取消、协议错误和 Provider 异常 EOF 已有明确语义。

静态分析得到的性能假设如下，必须通过第 5 节基线测试确认：

1. 每个 `delta` 或 `reasoning_delta` 都会生成新的 assistant message，并通过 conversation reducer 替换消息，进而让 `App` 和整个 `MessageList` 重新协调。
2. 历史消息没有独立 memo 边界；当前消息更新时，历史消息的 JSX 也会重新计算。
3. `MessageList` 为每条消息执行 `messages.slice(0, index).some(...)`，消息数量增长后会形成不必要的重复扫描。
4. 每次 Markdown 刷新都会对累计全文重新执行 MarkdownIt、DOMPurify 和 `innerHTML` 替换；长回答的单次成本随累计内容增加。
5. 自动滚动既由流事件主动调用，又由观察整棵消息 DOM 的 `MutationObserver` 触发，可能重复读取布局和安排滚动。

关键源码入口：

| 文件 | 当前职责 | 可能的优化点 |
| --- | --- | --- |
| `client/src/api/readChatStream.ts` | NDJSON 拆包和运行时协议交付 | 保持逐事件解析，不在这里改变协议或网络语义 |
| `client/src/hooks/useChatStream.ts` | 流生命周期、事件 reducer、UI 消息替换、取消与详情回拉 | 增加仅用于 UI 的有界事件缓冲与终止冲刷 |
| `client/src/reducers/chatStreamReducer.ts` | 六类 NDJSON v2 事件的纯状态转换 | 增加批量顺序归约入口，复用现有单事件语义 |
| `client/src/reducers/conversationReducer.ts` | 会话和消息不可变更新 | 保持公开 action 语义，避免无关状态更新 |
| `client/src/components/MessageList.tsx` | 所有消息行和消息级操作 | 抽取 memo 化消息行；线性计算历史条件 |
| `client/src/components/MarkdownMessage.tsx` | 流式节流和完成态 Markdown 渲染 | 基线后调整刷新节奏；必要时引入稳定前缀/活动尾部 |
| `client/src/utils/markdownRenderer.ts` | MarkdownIt、DOMPurify 和 highlight.js | 保持安全策略与完成态规范输出 |
| `client/src/hooks/useAutoScroll.ts` | 用户跟随意图、DOM 观察和 rAF 滚动 | 统一为尺寸变化驱动且每帧最多一次 |

## 3. 目标与非目标

### 3.1 目标

- 连续文本流在短、中回答中以稳定的视觉节奏更新，不因每个 Provider token 触发一次 React 提交。
- 首个应用可见正文或 reasoning 不被人为等待一个完整批次；第一批文本到达后立即或在下一帧显示。
- `done`、`error`、工具事件和取消边界前的文本全部冲刷，不丢字、不乱序、不重复。
- 用户停留在底部附近时持续跟随；用户上滚查看历史后不被抢回底部。
- 最终 Markdown DOM、安全清洗、代码块内容和完成态高亮语义与当前规范渲染保持一致。
- 优化效果以固定 mock 流和浏览器指标证明，并与修改前基线在同一机器、浏览器和构建模式下比较。

### 3.2 非目标

- 不把 NDJSON v2 改为 SSE、WebSocket 或 `application/json-seq`。
- 不修改 Provider adapter、后端流完整性门禁、持久化 schema、备份 schema 或 SQLite 表结构。
- 不通过后端大批量缓存牺牲首批内容延迟、停止响应和工具生命周期可见性。
- 不添加通用状态管理库、虚拟列表库、Markdown 框架或新的运行时依赖。
- 不增加逐 token CSS 动画、打字机动画或无法由自动化断言证明价值的视觉效果。
- 第一阶段不实现完整 Markdown 增量解析器；只有前面低风险阶段仍无法达到基线目标时才单独评估。

## 4. 设计原则

1. 网络事件与 UI 刷新解耦：每条 NDJSON 仍立即解析和校验，只有 React 可见状态更新允许合并。
2. 顺序优先：合并不能跨越 `tool_start`、`tool_result`、`done`、`error` 等语义边界重排事件。
3. 终止先冲刷：正常完成、错误、取消、卸载或会话切换前必须处理缓冲区，或明确丢弃属于已废弃视图的缓冲区。
4. 安全策略不降级：流式与完成态输出仍经过 DOMPurify；不能用性能优化绕过净化。
5. 完成态是规范结果：即使将来实现活动尾部渲染，收到 `done` 后仍对完整内容执行一次当前规范渲染。
6. 每阶段独立交付：先测量，再做最小改动；只有自动化证据证明仍有必要时才进入下一阶段。

## 5. 阶段 0：建立可重复性能基线

### 5.1 固定场景

使用本地 mock，不调用真实 DeepSeek、OpenAI、天气或其他外部服务，也不截图。每个场景都使用固定文本、事件大小、间隔和总字数：

| 场景 | 输入流 | 关键目的 |
| --- | --- | --- |
| 短正文 | 4KB，20ms 一次 `delta` | 首批显示和普通视觉节奏 |
| 中等 Markdown | 24KB，含段落、列表、链接和代码围栏 | Markdown 重算与滚动跟随 |
| 超长 Markdown | 80KB，含多个代码块 | 长回答主线程压力与完成态高亮 |
| reasoning + 正文 | reasoning 连续输出后切换正文 | 两类文本边界和思考耗时语义 |
| 工具两阶段 | 前导 reasoning、工具开始/结果、最终正文 | 缓冲不得跨工具事件乱序 |
| 中途错误 | 正文后 `error` | 错误前冲刷和部分正文保留 |
| 正常完成 | 最后一个文本片段后紧跟 `done` | 尾部冲刷、完成态渲染和详情回拉 |
| 手动停止 | 连续正文中点击停止 | 停止响应、已显示正文和持久化一致性 |
| 用户上滚 | 输出期间离开底部再返回 | 不抢滚动和恢复跟随 |
| 长历史 | 至少 200 条已完成消息后追加流式回答 | 历史消息协调和列表扫描成本 |

### 5.2 采集指标

测试或开发诊断钩子只记录数值，不写入会话，不上传数据，不进入生产 UI：

- 原始 NDJSON 事件数和到达时间。
- assistant 可见状态更新次数与相邻更新时间差。
- `MarkdownMessage` 渲染次数、单次耗时和累计耗时。
- 当前消息之外的历史消息行渲染次数。
- 自动滚动计划次数、实际执行次数和用户上滚后的误跟随次数。
- 首个流事件到首个可见文本的延迟。
- 最后一个文本事件到完整完成态 Markdown 的延迟。
- `PerformanceObserver` 可用时记录超过 50ms 的 long task；不可用时记录 CDP Performance/Tracing 中等价的主线程任务。
- 流式期间底部间距、页面横向溢出和 390px 响应式状态。

### 5.3 基线与目标口径

所有性能比较必须满足：同一台机器、同一浏览器主版本、同一生产构建或同一开发构建模式、相同 mock 数据、至少运行 5 次并报告中位数和最差值。

候选目标如下；阶段 0 完成后允许根据基线调整一次，但必须在实现前写回本文，不能在实现后为了通过测试而降低：

- 短正文和中等 Markdown 连续输出时，可见更新间隔的 P95 不超过 120ms。
- 第一批文本不额外等待 Markdown 常规节流周期；从首个文本事件到可见文本的新增客户端延迟目标不超过 50ms。
- UI 消息提交频率上限约为每秒 25 次，同时不低于连续输出时每秒 8 次。
- 短正文和中等 Markdown 流式期间不出现超过 50ms 的新增主线程 long task。
- 超长 Markdown 相比基线的 Markdown 累计渲染时间至少下降 30%，且不能增加 long task 数量。
- 用户上滚后的误跟随次数为 0；处于跟随状态时每帧最多执行一次实际滚动。
- 所有场景最终文本、reasoning、工具状态、错误、完成状态和持久化详情与输入事件完全一致。

这些数字是候选验收阈值，不是当前已验证结果。

## 6. 阶段 1：有界合并文本事件

### 6.1 方案

在 `readChatStream` 与 React message dispatch 之间增加客户端内部缓冲，建议形成独立、可单测的 `chatStreamEventBuffer` 或等价 hook/helper：

```text
NDJSON event received
  -> validate immediately
  -> record { event, receivedAt }
  -> text event enters bounded buffer
  -> first visible text flushes immediately
  -> later text flushes every 40ms at most
  -> semantic boundary flushes pending text first
  -> reduce buffered events in original order
  -> replace assistant message once
```

实现约束：

- 缓冲项必须保留接收时间，不能在 40ms 后统一使用冲刷时间计算 reasoning 起点。
- 只合并相邻且同类型的 `delta` 或 `reasoning_delta` 内容；不同类型和工具事件保持原顺序。
- 第一段非空正文或 reasoning 立即冲刷，后续连续片段才进入 40ms 合并周期。
- `tool_start`、`tool_result` 到达时先冲刷文本，再立即应用工具事件。
- `done` 和 `error` 到达时把剩余文本与终止事件按顺序同步归约，之后取消 timer。
- 手动停止时，已收到且属于当前请求的缓冲文本必须先进入当前 UI；`transition`、`unmount` 或已废弃会话的缓冲不得污染新页面。
- idle timeout 继续由原始网络 chunk 重置，不能改为由 UI 冲刷重置。
- 缓冲必须有最大事件数或最大字符数；达到上限立即冲刷，避免后台标签页或定时器节流导致无界增长。
- 不改变 `ChatStreamEvent`、`X-Chat-Stream-Protocol` 或后端事件发送频率。

### 6.2 文件级改动候选

- 新增 `client/src/utils/chatStreamEventBuffer.ts`：纯缓冲、相邻文本合并和终止冲刷规则。
- 修改 `client/src/hooks/useChatStream.ts`：连接缓冲与现有 reducer、取消、错误和详情回拉。
- 修改 `client/src/reducers/chatStreamReducer.ts`：增加按 `{ event, receivedAt }[]` 顺序归约的纯函数；单事件入口继续保留。
- 新增或扩展根目录 `tests/client/` 下的 buffer、reducer 和 hook 测试，不把测试散落到源码目录。

### 6.3 验收

- 100 个连续正文事件产生的 React assistant message 更新次数显著低于 100，且最终文本逐字一致。
- reasoning/正文交替、工具边界、`done`、`error` 和取消场景没有重排、重复或丢失。
- 第一段内容及时显示；连续输出更新频率落在第 5.3 节范围内。
- timer 在正常完成、错误、取消、切换和卸载后均无残留更新。

### 6.4 回滚

删除内部缓冲并恢复 `onEvent -> reduceChatStreamEvent -> replace-message` 的直接路径即可；NDJSON、后端和持久化均不受影响。

## 7. 阶段 2：隔离消息行与消除列表重复扫描

### 7.1 方案

- 从 `MessageList` 抽取展示专责的 `MessageRow`，通过 `React.memo` 让未变化的历史消息保持引用稳定时跳过重新渲染。
- 确保传入 `MessageRow` 的消息操作回调引用稳定；不要用每轮列表渲染新建的内联包装函数破坏 memo。
- 在一次从前到后的遍历中维护“此前是否存在已持久化用户消息”，替代每条消息的 `slice(0, index).some(...)`。
- 保持 `MessageRow` 只负责单条消息、reasoning、工具状态和操作按钮，不把请求生命周期或会话数据加载移入展示组件。
- 当前阶段不引入虚拟列表。可变高度 Markdown、代码块、文本选择、搜索跳转和滚动跟随会显著扩大虚拟化风险。

### 7.2 文件级改动候选

- 新增 `client/src/components/MessageRow.tsx`。
- 修改 `client/src/components/MessageList.tsx`，只负责线性派生列表级条件和组合行。
- 必要时修改 `client/src/app/App.tsx` 或 `useChatAppController.ts`，提供稳定回调引用。
- 扩展 `tests/client/components/MessageList.test.tsx`，并增加渲染次数或引用稳定性的定向测试。

### 7.3 验收

- 200 条历史消息场景中，流式更新当前 assistant 时，未变化历史行不重复渲染。
- 编辑、重新生成、复制、重试和 `persistedIndex` 可见条件保持不变。
- 桌面和 390px 布局、reasoning、工具轨迹和生成详情不回归。

### 7.4 回滚

`MessageRow` 可以重新内联回 `MessageList`；不涉及协议、状态数据形状或持久化迁移。

## 8. 阶段 3：统一自动滚动驱动

### 8.1 方案

- 使用底部 sentinel 或等价的底部距离判断维护“是否跟随”状态。
- 使用 `ResizeObserver` 观察当前流式消息或消息列表内容盒尺寸变化，只在高度真实变化时安排滚动。
- 所有滚动请求继续经过同一个 `requestAnimationFrame` 调度器，每帧最多执行一次。
- 移除每个流事件后的重复 `followNewContent()` 布局读取；保留用户提交后、会话切换后和完成后的必要显式定位。
- 用户滚动离开阈值后立即停止跟随；用户回到底部阈值内后恢复。
- `ResizeObserver` 不可用时保留受控 fallback，但 fallback 不应同时与主路径重复运行。

### 8.2 文件级改动候选

- 修改 `client/src/hooks/useAutoScroll.ts`：由整棵 DOM `MutationObserver` 转为尺寸变化和单一 rAF 调度。
- 修改 `client/src/hooks/useChatStream.ts`：删除每个业务事件后的重复滚动触发，仅保留生命周期边界调用。
- 修改 `client/src/app/App.tsx` 或 `MessageList.tsx`：增加底部 sentinel 或当前流式行 ref。
- 扩展 `tests/client/hooks/lifecycleHooks.test.tsx` 和 `tests/cdp/scenarios/ui/layout-scroll.mjs`。

### 8.3 验收

- 处于底部时，正文、reasoning 和增长中的代码块持续保持底部间距在既有阈值内。
- 用户上滚后不会被任何文本、工具或 Markdown DOM 更新抢回底部。
- 同一动画帧多次尺寸变化只执行一次实际滚动。
- observer、scroll listener 和 animation frame 在卸载或切换后全部清理。

### 8.4 回滚

恢复当前 `MutationObserver + requestAnimationFrame` 方案；该阶段不改变消息状态或协议。

## 9. 阶段 4：调整 Markdown 刷新节奏

只有阶段 1 至阶段 3 完成并重新测量后才进入本阶段。

### 9.1 第一层：调整现有全文渲染节流

候选初始值：

| 累计内容长度 | 当前 | 候选值 |
| --- | ---: | ---: |
| `< 12KB` | 160ms | 80ms |
| `12–40KB` | 260ms | 160ms |
| `> 40KB` | 420ms | 300ms |

这些值必须用第 5 节固定场景验证后确定。目标是缩小“成段跳出”的视觉间隔，同时通过前面阶段降低外围 React 和滚动成本，避免单纯提高 Markdown 全文重算频率。

保持以下规则：

- streaming-lite 继续关闭 highlight.js。
- MarkdownIt 和 DOMPurify 安全规则保持不变。
- `done` 后立即冲刷最新内容，并进行一次完整 Markdown 渲染和代码高亮。
- 完成态渲染失败时进入可诊断错误，不保留与最终正文不一致的旧流式 DOM。

### 9.2 第二层：稳定前缀与活动尾部（条件候选）

只有调整节流后，超长 Markdown 仍未达到第 5.3 节目标，才另行设计和确认：

```text
稳定前缀：已闭合且不会再被后续语法改变的 Markdown 块
活动尾部：最后一个仍可能增长或影响解析的块
```

可缓存的候选边界包括闭合段落、闭合代码围栏和完成列表；必须专项处理未闭合代码围栏、链接、强调、列表延续和表格。活动尾部仍需经过 DOMPurify，收到 `done` 后对全文执行一次规范渲染，并自动比较最终 DOM/text 与直接完整渲染结果。

这一层的复杂度和错误风险明显高于前面阶段，不得与阶段 1 至阶段 3 合并为一次大改动。

## 10. 可选的长会话 CSS 优化

如果阶段 2 后浏览器证据仍表明屏幕外历史 Markdown 占用明显布局或绘制时间，可单独评估：

```css
.message-row {
  content-visibility: auto;
  contain-intrinsic-size: auto 180px;
}
```

实施前必须验证浏览器支持、搜索跳转、文本选择、滚动锚定、代码块高度和历史消息展开行为。它不是第一阶段默认改动，也不能替代消息行 memo。

## 11. 完整测试计划

### 11.1 单元测试

- buffer：相邻文本合并、不同类型不重排、最大容量、首次立即冲刷、定时冲刷。
- terminal：`done`、`error` 前冲刷；terminal 后忽略多余事件；timer 清理。
- lifecycle：手动停止、timeout、transition、unmount 和请求替换不产生迟到更新。
- reducer：批量归约结果与按相同时间顺序逐事件归约结果一致。
- MessageRow：历史消息 memo 边界、操作条件、reasoning、工具和生成详情不变。
- Markdown：streaming-lite 安全输出、完成态高亮、未闭合围栏和最终冲刷。
- auto scroll：每帧一次、上滚停止、回到底部恢复、observer 清理。

### 11.2 CDP 自动化

代码修改后，执行前先按仓库规则列出本轮场景、mock、断言、真实服务和截图边界。默认使用本地 mock，不截图，不调用真实 Provider。

建议扩展现有 UI/roadmap/Markdown 场景，而不是另建重复的浏览器总 runner：

- 固定节奏正文和 reasoning，采集可见更新时间序列。
- 长 Markdown 流式阶段保持 `streaming-lite`，完成后切换 `complete` 且代码高亮正确。
- 工具开始/结果与正文顺序一致。
- `done`、错误、停止前最后一批文本不丢失。
- 200 条历史消息下当前回答仍可持续更新。
- 底部跟随、主动上滚和重新回到底部。
- 390px 无横向溢出。
- 使用 Performance/Tracing 或页面诊断钩子输出机器可读指标；断言不得只依赖截图或肉眼观察。

### 11.3 最小验证命令

具体范围由实际修改文件决定，候选完整门禁为：

```bash
pnpm run check
pnpm run test:client
pnpm run build:client
pnpm run test:cdp:ui
pnpm run test:cdp:markdown
pnpm run test:cdp:highlight
pnpm run test:cdp:roadmap
git diff --check
```

若阶段 1 修改取消、错误或流生命周期，再增加：

```bash
pnpm run test:unit
pnpm run test:cdp:p0
```

不需要真实 Provider 验证，因为优化边界位于 Provider adapter 和 NDJSON v2 之后；只有用户明确要求真实接口对比时才运行真实套件。

## 12. 分阶段交付与回滚

| 交付 | 内容 | 独立回滚点 |
| --- | --- | --- |
| A | 性能基线与机器可读结果 | 删除诊断钩子或仅保留测试 helper |
| B | 文本事件有界合并 | 恢复逐事件 dispatch |
| C | MessageRow memo 与线性列表派生 | 恢复单体 MessageList |
| D | ResizeObserver/rAF 滚动 | 恢复 MutationObserver 跟随 |
| E | Markdown 节流参数 | 恢复 160/260/420ms |
| F | 稳定前缀/活动尾部，仅在必要时 | 恢复规范全文渲染 |

每个交付都必须分别检查 diff、运行对应最小回归并记录性能前后数据。不能把 B 至 F 合并成一个难以定位回归的大提交。

## 13. 开始实施前的确认项

本文完成后仍不自动进入实施。开始下一阶段前需要明确确认：

1. 是否把“流式渲染平滑度优化”选为 R16 之后的下一个单一范围。
2. 第一轮只实施阶段 0 至阶段 3，还是阶段 0 验证后逐阶段再次确认。
3. 性能采集是否只保留在测试/dev 环境；本方案推荐不进入生产 UI，也不持久化。
4. 阶段 0 测得的基线是否支持第 5.3 节候选阈值；若调整，必须在实现优化前记录理由。

在这些确认完成前，本文件只作为候选设计与验收依据，`docs/roadmap.md` 不应把该范围标记为进行中或已完成。
