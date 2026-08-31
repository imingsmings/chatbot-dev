# P2 模型 fallback 单一事实源验收记录（2026-08-31）

结论：模型 ID、正式标签、Provider 默认模型、能力与禁用状态现在只由服务端 model catalog 声明。React 已删除完整 DeepSeek 静态 fallback、能力副本、全局 Max Tokens 副本和静态模型 ID 类型；运行目录不可用时不再猜测模型能力或绕过禁用状态。

## 问题与边界

旧客户端在 `/api/runtime-config` 缺少有效 `providers` 时，合成包含三个 DeepSeek 模型及 tools、reasoning、temperature、输出上限和 Vision 能力的本地目录。该目录不含服务端 `LLM_DISABLED_MODELS` 状态，因此服务端目录更新、能力变化或禁用模型时存在前后端漂移。

本项只收敛模型目录与安全 fallback，不改变 Provider adapter、请求/响应 API、NDJSON v2、会话 `modelOptions` schema 或存储格式，也不增加依赖。

## 已实现

- `server/utils/llm/modelCatalog.ts` 同时声明 Provider 默认模型和模型能力；`providerConfig.ts` 不再维护第二份默认模型常量。
- `/api/runtime-config` 继续下发运行时目录、当前配置与服务端计算的禁用状态，React 只对该目录做结构过滤和不可变复制。
- 客户端不再包含具体模型 ID、模型列表、能力上限或 Vision 模型名称；新模型无需修改 React 生产代码即可显示和使用。
- 失效或禁用的会话模型优先回退到当前运行 Provider 的目录默认模型；兼容端点使用未登记能力的自定义默认 ID 时，仍留在当前 Provider 并选择其首个可用目录模型，之后才考虑其他已配置 Provider。
- 目录为空或损坏时返回空可用目录：模型按钮和发送按钮禁用，不发 `/ask` 或模型配置 PATCH；已有会话仍可浏览，textarea 仍可编辑未发送草稿，刷新后可恢复。
- 图片能力与切换提示从服务端目录动态取得；没有已配置图片模型时给出明确提示，不硬编码 Vision 型号。
- 历史生成元数据的模型 ID 仅用通用格式化规则显示，不构成可选择模型目录。

## 自动化覆盖

- 服务端专项：Provider 默认值来自 catalog；配置覆盖、能力和禁用校验保持不变。
- React 纯逻辑/Hook/组件/App：服务端独有模型 ID、标签、图片能力和 `maxOutputTokens=777` 可直接生效；空目录不合成本地模型；设置与发送 fail-closed。
- CDP Mock：会话保存/回滚/刷新保持；服务端独有模型菜单只显示服务端条目；服务端禁用条目不可交互；Temperature 隐藏、Max Tokens 上限为 777；空目录不发 ask、发送禁用且草稿可编辑。
- 真实 Provider、Docker、生产集成本项不需要验证：没有改变 Provider 请求形状、协议、部署或持久化边界。

最终门禁：

- `pnpm run check`：通过。
- `pnpm run test:unit`：服务端 173/173、React 119/119 通过。
- `pnpm run build:client`：通过。
- `CDP_SCREENSHOTS=0 CDP_SCRIPT_RETRIES=0 pnpm run test:cdp:all-mock`：18/18 脚本首轮通过，未生成截图。

## 回滚边界

回滚只涉及 model catalog 默认值声明、React runtime catalog 消费和对应测试/文档。不得恢复完整客户端模型/能力 fallback；若未来需要离线只读体验，应继续保持发送 fail-closed，而不是复制服务端能力。
