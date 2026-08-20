# R8.5 React 设计 QA

> 历史快照：本文记录 2026-08-01 至 2026-08-02 的迁移期视觉验收。`proto/` 和 `.tmp/` 均为本机忽略目录，截图没有纳入仓库，不能作为新环境中的可复现证据；当前 UI 结论应以浏览器自动化断言为准。

日期：2026-08-01
结论：`final result: passed`

## 1. 对照范围

| 状态 | 设计源 | React 实现截图 | 同屏对照 |
| --- | --- | --- | --- |
| 深色主界面 + 会话菜单 | `proto/chat-ui-dark-final.png` | `.tmp/design-qa/react-dark-final.png` | `.tmp/design-qa/compare-dark-final.png` |
| 深色思考强度菜单 | `proto/chat-ui-dark-effort-menu.png` | `.tmp/design-qa/react-dark-effort-menu.png` | `.tmp/design-qa/compare-dark-effort-menu.png` |
| 浅色模型菜单 | `proto/chat-ui-light-model-menu.png` | `.tmp/design-qa/react-light-model-menu.png` | `.tmp/design-qa/compare-light-model-menu.png` |
| 深色输入区局部 | `proto/chat-ui-dark-final.png` | `.tmp/design-qa/react-dark-final.png` | `.tmp/design-qa/compare-dark-composer.png` |
| 浅色菜单局部 | `proto/chat-ui-light-model-menu.png` | `.tmp/design-qa/react-light-model-menu.png` | `.tmp/design-qa/compare-light-menu-focus.png` |
| 390px 响应式 | 不适用 | `.tmp/design-qa/react-mobile.png` | DOM 尺寸断言 |

`proto/` 是用户提供、只读且被 Git 忽略的本地 UI 设计源；QA 没有修改其中任何文件。

## 2. 视口与状态

- 深色视口：`1586 × 992` CSS px；reasoning 展开；分别打开当前会话菜单和思考强度子菜单。
- 浅色视口：`1619 × 972` CSS px；reasoning 展开；打开模型子菜单。
- 响应式视口：`390 × 844` CSS px；检查侧栏横向会话、正文、表格滚动容器和 Composer。
- 数据密度：11 个本地 fixture 会话，分为“今天 / 昨天 / 更早”；当前会话含 user、reasoning、Markdown 标题、列表、表格和回答操作。
- 浏览器：Codex 内置浏览器；本地 React Vite 与临时本地后端，不调用真实模型或真实外部服务。

## 3. 可测量结果

桌面深色状态的关键实现尺寸：

- 侧栏：`302px`；标题 `x=332`；reasoning `x=434`；正文/表格宽 `884px`。
- 用户消息：`x=1167`、`y=68`、宽约 `355px`、高约 `50px`。
- Composer：`x=425`、`y=837`、`1038 × 128px`。
- 模型按钮：`x=1080`；麦克风 `x=1347`；发送按钮 `x=1397`。
- 思考强度主菜单：`x=942`、`y=720`、宽 `316px`；子菜单：`x=1270`、`y=654`、宽 `214px`。

浅色状态的关键实现尺寸：

- 侧栏：`318px`；正文 `x=423`；表格 `932 × 181px`。
- 用户消息：`x=1184`、`y=39`、约 `389 × 60px`。
- Composer：`x=422`、`y=808`、`1105 × 123px`。
- 模型主菜单：约 `x=930`、`y=713`、宽 `330px`；模型子菜单约 `x=1272`、宽 `300px`。

390px 状态的 DOM 断言：

- `documentElement.scrollWidth <= innerWidth`：通过。
- Sidebar、Header、Chat Scroll、Composer 顺序无重叠：通过。
- Composer、模型选择和发送按钮均位于视口内：通过。
- Markdown 表格由消息容器承接横向滚动，没有造成页面级横向溢出：通过。

## 4. 迭代记录

1. 第一轮确认功能页面完整，但桌面内容密度仍偏向旧客户端。
2. 第二轮按设计源重新测量侧栏、正文、表格和 Composer，修正桌面布局比例。
3. 第三轮修正浅色和深色各自的正文宽度、消息位置、表格行高和输入区尺寸。
4. 第四轮补齐 Base UI 两级菜单的尺寸、碰撞方向、偏移和选中态，并用同视口同状态重新同屏比较。
5. 最终轮补做 390px DOM 尺寸断言、主题切换、reasoning 展开、会话菜单、模型菜单和思考强度菜单交互检查。
6. 2026-08-01 完成 Tailwind utility-first 整改：页面、侧栏、消息、Composer、菜单与弹窗样式迁入 TSX/shadcn variants；`globals.css` 从 1828 行降到 403 行，并重新通过桌面/390px DOM、首条消息顶部可见、模型/推理菜单、主题和弹窗交互断言。本次结构整改未重新生成截图，现有截图继续作为 `proto/` 视觉对照证据，自动化 DOM 结果作为整改后的运行证据。

## 5. 最终检查

- P0 阻塞问题：无。
- P1 主要视觉或交互问题：无。
- P2 信息性差异：设计图展示了用户消息时间和复制图标，但现有服务端消息契约没有逐条时间戳；本轮不伪造数据字段，也不改变持久化格式。回答复制、reasoning、菜单、主题和响应式主路径均已实现。
- 当前预览在默认 `1280 × 720` 视口无页面级横向溢出；最终重新加载没有产生新的 console error。日志中仅保留一次旧 Vite 进程停止期间的历史 HMR 断连记录，重启后未复现。

最终判定：视觉层级、布局、主题、菜单状态、响应式和核心交互达到 R8.5 验收门槛，`final result: passed`。

---

# 2026-08-02 字号、内容列与模型菜单复核

结论：`final result: passed`

## 对照范围与状态

- 用户临时参考图（未纳入仓库）用于确认约 14px 正文字号、消息列与 Composer 同宽、无边框模型入口。
- 用户临时菜单参考图（未纳入仓库）用于确认“左侧分组 + 右侧子菜单”、浅灰当前项和勾选状态。
- 用户临时贴合菜单和 Composer 参考图均未纳入仓库，原系统临时路径不作为可复现证据。
- React 最终界面：`.tmp/design-qa/react-density-final.png`；最终模型菜单：`.tmp/design-qa/react-model-menu-final.png`；展开 reasoning 间距：`.tmp/design-qa/react-reasoning-gap-final.png`。
- 贴合菜单最终截图：`.tmp/design-qa/react-menu-attached-final.png`；输入区最终截图：`.tmp/design-qa/react-composer-controls-final.png`。
- 菜单同屏对照：`.tmp/design-qa/compare-model-menu-final.png`。参考图与实现截图裁切范围、像素密度不同，因此按菜单结构、字体、行高、选中态和相对间距做局部归一化比较，不把截图绝对坐标当作实现约束。
- 本轮局部同屏对照：`.tmp/design-qa/compare-menu-attached-final.png`、`.tmp/design-qa/compare-composer-controls-final.png`。
- 状态：浅色主题、`1280 × 720` CSS px、已有“你好 我是 iPad Pro”会话、DeepSeek V4 Pro、思考强度高；浏览器重新加载后没有新增 warning/error。

## 可测量结果

- 常规助手正文：`14px / 23.1px`；Composer 输入、reasoning 摘要和模型入口同为 `14px`。
- 消息内容列：`x=407px`、宽 `845px`；Composer：`x=407px`、宽 `845px`、高 `104px`，左右边界误差为 `0px`。
- 模型入口：宽约 `157.37px`、高 `32px`、边框 `0px`，保留轻量 hover/open 背景反馈。
- 模型主菜单约 `284px`，模型子菜单约 `240px`；主行和模型项不超过 `36px`，仅展示 DeepSeek V4 Flash / Pro。
- 主菜单右边界与模型子菜单左边界实测间隔 `0px`；首次用 `sideOffset=0` 时出现 `-7px` 重叠，按 Base UI 定位补偿校正为 `7px` 后实现视觉贴合且不重叠。
- 语音与发送按钮计算尺寸均为 `34 × 34px`；发送箭头缩至 `15px`。输入框占位文案在空会话和已有会话中统一为 `Ask AI`。
- 推理强度子菜单保留关闭、低、中、高四档；模型和推理强度都完成真实点击切换断言。
- `390 × 844` 响应式状态无页面级横向溢出，Chat Scroll 与 Composer 无重叠。

## 迭代结论

1. P2：常规正文、输入区、reasoning 和菜单字号偏大。已统一收敛到约 `14px`，标题与辅助信息仍保留必要层级。
2. P2：消息列表与 Composer 采用两套独立宽度。已改为共享 `CHAT_CONTENT_COLUMN_CLASS`，桌面与响应式都由同一内容列约束。
3. P2：模型入口过宽且有描边，主菜单/子菜单偏松。已改为 32px 高无边框入口，并按参考图收紧二级菜单、当前项背景和勾选位置。
4. P2：reasoning 与回答正文之间叠加了 `49px` 上外边距，展开后留白过大。已改为 `6px` 上外边距，连同容器 gap 的最终可视间距约 `13px`，并加入 `8px–16px` 自动化边界断言。
5. P2：二级菜单离主菜单过远、发送按钮相对语音按钮偏大、输入提示语不符合新文案。已将菜单可见间隔校正为 `0px`，两按钮统一为 `34px`，占位文案改为 `Ask AI`。
6. P0/P1：无。最终页面结构、颜色、字体密度、间距、模型菜单和响应式均通过视觉与 CDP 双重复核。

最终判定：本轮三个整改项及追加的二级菜单参考均已落地，`final result: passed`。
