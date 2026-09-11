# 聊天工作区 UI 整改

日期：2026-09-07。范围：经确认的桌面工作区，以及后续确认的 ChatGPT 风格移动版。保留 React、shadcn/ui Base UI、Lucide，不新增依赖或后端能力。

## 实现规范

| 区域 | 落地约定 |
| --- | --- |
| 主题 | 浅深色仅切换语义颜色；不再改变布局宽度、偏移和底部留白 |
| 阅读 | 正文 14px/24px，标题 16px/18px；内容列最大 820px，与输入区共用布局类 |
| 侧栏 | 桌面 248px、可收起；820px 及以下采用抽屉；保留搜索、分组、更多操作 |
| 身份区 | 32px 原有头像、姓名与独立设置入口；清空当前会话移到顶栏会话操作，不混入个人设置 |
| 输入区 | 桌面初始 104px；手机单行 52px，正文输入后受限增高；聚焦不加边框，加号无边框；桌面独立模板入口，手机放入添加菜单；不增加语音 |
| 空态 | 桌面问候、建议、输入区组合在中部；手机问候居中、输入区始终位于底部 |
| 模型 | 桌面模型与思考强度独立单层菜单；手机顶部入口与底部面板；分组 12px、选项 14px；禁用状态附不可用/未配置，选中模型有勾选 |
| 工具 | 模型参数、摘要、清空位于会话更多菜单；上下文桌面为独立入口、手机移入更多；删除和清空继续二次确认 |
| 上下文 | 大于 1100px 使用 320px 内嵌侧栏，否则使用抽屉；概览/原始请求分开，原始消息与工具默认折叠 |
| 提示 | 图标保留可访问名称；Tooltip 使用 Portal 与碰撞避让，无箭头，避免遮挡文字 |

模型能力、禁用原因和选项来自服务端目录，不复制概念图中的模型列表。真实头像保持原有资产，不新增在线状态、点赞或其他假功能。

## 状态与边界

- 保留会话级模型选项、持久化、分支、发送、流式渲染、取消确认和错误恢复协议。
- 切换、新建、删除、清空会话继续清理草稿，不改为跨会话保留。
- 上下文预览是请求快照。草稿、模型、附件、历史或会话变化后关闭旧快照，迟到响应不重新打开旧面板。
- 上下文读取期间保持原有互斥保护；显式返回焦点，避免按钮临时禁用导致关闭侧栏后失焦。
- 菜单关闭仅清理同一个菜单，避免旧菜单的延迟关闭事件误关新菜单。
- 移动端有 44px 主要触摸区域；桌面维持紧凑按钮。输入框不描边不意味着移除菜单和按钮的键盘焦点反馈。

## 代码边界

- `client/src/styles/chat-workspace.css`：本次工作区样式独立文件；`globals.css` 仅承载共享颜色和 Markdown 排版。
- `App.tsx`：组合侧栏、主区、输入区与上下文，不承担 API 细节。
- `SidePanel.tsx`：统一内嵌面板和窄屏抽屉，接受 open/modal/side、关闭回调与返回焦点 ref；无业务状态。
- `ModelOptionsMenu.tsx`：仅负责显示与选择，独立 open/effortOpen 受控状态，选项变更继续交给既有控制器。
- `ContextDebugModal.tsx`：名称保留兼容，内容改为侧栏/抽屉，使用现有 ContextPreview 数据。
- `useConversationInsights.ts`：快照有效性与请求结果隔离；未修改服务端请求形状。

## 验收与证据

测试用例见 [回归用例](./regression-test-cases.md)。本轮执行记录与源图/实拍对照见项目根目录 [design-qa.md](../design-qa.md)。

桌面轮历史结果：类型检查、标准/类型感知 lint、生产构建通过；React 单测 28 文件、130/130；完整 Mock CDP 19/19 脚本全部一次通过。截图专项额外验证 1487x1058 对照图和弹窗 Tooltip。所有浏览器场景使用 Mock，不调用真实模型。该记录不代表后续移动版重新执行了全量 Mock。

```sh
bun run check
bun run test:client
bun run build
CDP_SCRIPT_RETRIES=0 bun tests/cdp/run-cdp-regression.mjs all-mock
# 仅在允许截图时执行；确保 DEBUG_PORT 未占用。
DEBUG_PORT=9425 CDP_SCREENSHOTS=1 bun tests/cdp/scenarios/ui/workspace-layout.mjs
```

概念图和最终实拍位于 `proto/ui-refresh-2026-09-07/`。该目录被 Git 忽略，因此这份说明与测试文件作为可提交的验收入口。图片内容及上下文预算为本地 Mock 样本，不是 Provider 执行证据。

不含真实模型、付费 API、Docker 或真机软键盘验收；相关既有脚本只同步选择器，不将静态更新视为通过。

## 移动版落地

以 `proto/mobile-ui-redesign-2026-09-07/chatgpt-inspired-dark.png` 为方向，820px 及以下启用独立布局；桌面维持本轮之前的布局和入口。此版本是已有 React 应用的响应式改造，不是图片覆盖或独立演示应用。

- 顶部 52px：会话列表、当前具体模型、新建、更多。长会话标题留在列表和可访问标题中；长模型名省略但保留完整可访问名称，实际模型来自服务端目录。
- 正文 14px/24px，内容左右 16px。回答无头像或卡片，思考信息仍为单层折叠；保留复制、编辑和重新生成，用户编辑按钮放在气泡左侧，不再额外占一行。
- 输入区 52px 起，圆角 26px、无外框，内含加号、文本和发送。发送圆形视觉尺寸 32px、热区 44px；可发送亮底，空白禁用灰色，生成中保持停止方块及停止等待态。
- 消息正文仍为 14px；手机输入控件为 16px/24px，提升输入可读性。多行最多 144px 或 25dvh，短视口不超过 96px。附件独立占上方区域、内部滚动，重试和移除热区 44px。
- 模型面板从底部打开，分组 12px、模型 14px/48px 行高，思考强度等宽选择区域 44px。保存中禁止重复变更，关闭仍可用；失败沿用现有提示与回滚，关闭后焦点返回模型入口。
- 会话和上下文在手机使用全宽模态面板；背景受限、Escape 可关闭。手机更多菜单访问上下文，关闭后返回更多按钮；模板从加号访问。
- 暗色聊天底色 `#212121`、输入和用户气泡 `#303030`；浅色白底、输入 `#f1f1f1`、用户气泡黑底白字。两种主题共用尺寸，不引入渐变或生成图纹理。
- `visualViewport` 高度与偏移驱动手机布局和弹层高度；忽略 pinch zoom 的缩放状态，退出手机断点后清理监听和样式。安全区通过现有 `env(safe-area-inset-bottom)` 处理。

### 移动版代码边界

- `MobileModelSheet.tsx`：受控展示组件；接收 options/runtime、open/disabled/saving，回调 onChange/onOpenChange；内部只有元素 ref 和唯一 ID，不拥有请求或持久化状态。
- `chat-mobile.css`：独立的移动样式和 reduced-motion 规则，按断点覆盖，不改变桌面样式。
- `useMobileViewport.ts`：只同步浏览器视觉视口，不修改聊天状态；单测模拟高度、偏移、缩放和卸载。
- `ChatComposer.tsx`：新增 mobile 展示开关、跟随 CSS 上限的 textarea 高度和宽度变化监听；既有提交/取消/附件回调不变。
- `App.tsx` 与 `AppActionsMenu.tsx`：组合移动入口并提供显式返回焦点 ref；`ui/dialog.tsx` 扩展 bottom 位置，不引入新弹层库。

### 移动版验收入口

```sh
bun run test:client
bun run build # 包含 check、类型检查和 lint
CDP_SCRIPT_RETRIES=0 DEBUG_PORT=9427 CDP_SCREENSHOTS=1 bun tests/cdp/run-cdp-regression.mjs ui
CDP_VISION_PORT=9428 CDP_SCREENSHOTS=1 bun tests/cdp/image-attachments.mjs
```

实拍、模型面板、短视口和归档断言位于 `proto/mobile-ui-redesign-2026-09-07/implemented/`；可提交的验收说明留在本文、回归文档和根目录 `design-qa.md`。本轮只验证本地 Mock UI 与静态/组件，不调用真实 Provider、Docker，也不将 CDP 短视口或 Hook 模拟当作真机软键盘证据。

最终结果：React 30 文件、137/137；`build`（含 check/lint）通过；无自动重试 UI 集合 9/9 通过，每个脚本一次执行、exitCode=0；附件专项通过。早期测试发现的排序、焦点等待与旧选择器问题已修正后复跑，普通/聚焦手机输入样式覆盖缺陷也已修复并新增断言。归档 `ui.json`、`results.json`、`attachments.json`，不宣称本轮执行了完整 20 项 Mock。

### 后续全端回归

用户随后确认执行全量 Mock 与真实测试，包含手机、平板断点和桌面。该次执行的结果、真实失败、显式复测、测试修正及清理边界单独记录在 [全端回归验收](full-stack-regression-2026-09-07.md)。上文的“仅 Mock”是 UI 实现阶段的历史边界，不替代后续测试记录。
