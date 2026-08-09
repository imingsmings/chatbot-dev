# Chatbot Roadmap

项目定位：个人学习和内部使用。优先级是本地稳定、可调试、可回归和自用效率；不面向多租户 SaaS、计费或公开大规模部署。

## 当前状态

- P0-P7：核心聊天、存储、工具、上下文、摘要、导入导出、Markdown 与回归体系已完成。
- R8.0-R8.6：React 并行迁移阶段已完成。
- R8.7：React-only 切换与阶段交付加固已实施；`client/` 为唯一前端，Vue/Volar/SFC 和双端 parity 测试已移除。
- R8.8：Express 同源托管 React 构建、统一 `/api`、HTTPS fail-fast 与部署文档已完成并通过最终门禁。
- R8.9：TypeScript 7 前后端统一、根 workspace/catalog、共享 tsconfig 与 Express 5 升级已完成。
- R9：DeepSeek Chat Completions 与 OpenAI Responses provider adapters 已完成。

当前阶段不增加功能，只接受缺陷、边界测试、维护性和文档修复。

## 当前基线

- React 19 + TypeScript 7 + Vite 8。
- Tailwind CSS 4 + shadcn/ui Base UI + Lucide React。
- Express 5.2 + TypeScript 7，与前端共用根 TypeScript 基础配置。
- file/SQLite 会话持久化。
- DeepSeek/OpenAI 请求级 provider/model 与 reasoning 配置。
- 应用 NDJSON v2、reasoning 和工具生命周期。
- 全链路取消、首包/流空闲超时和单会话请求互斥。
- Node/Vitest/CDP 自动化回归。

## 已完成矩阵

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 配置校验、核心发送/停止、回归入口 | 完成 |
| P1 | 多会话、持久化、Markdown、代码高亮 | 完成 |
| P2 | Function Calling 与工具失败隔离 | 完成 |
| P3 | reasoning 流式、耗时与持久化 | 完成 |
| P4 | 上下文窗口与摘要 | 完成 |
| P5 | 搜索、导入导出、上下文预览 | 完成 |
| P6 | UI 异步状态、响应式和主题 | 完成 |
| P7 | file/SQLite、迁移和 CDP 回归 | 完成 |
| R8.0-R8.6 | React 工具链、核心逻辑、hooks、UI、Tailwind/shadcn、并行验收 | 完成 |
| R8.7 | React 接管 `client/`、删除 Vue、并发/异常加固、文档收口 | 完成并验证 |
| R8.8 | React 构建托管、SPA 回退、HTTPS、缓存和部署边界 | 完成并验证 |
| R8.9 | TypeScript 7 统一、pnpm catalog/单 lockfile、共享 tsconfig、Express 5.2 | 完成并验证 |
| R9 | OpenAI Responses adapter、reasoning summary、Function Calling continuation | 完成 |

## R8.7 交付边界

- 根 `dev:client`、`typecheck:client`、`build:client`、`lint:client` 全部指向 React `client/`。
- Vite 唯一开发端口为 5173。
- 删除 Vue 源码、Vue/Volar 依赖、Vue Node tests 与双实现 parity tests。
- React 删除当前会话、首包超时、模型目录损坏和协议非法字段有回归测试。
- file store 同会话并发 mutation 串行化，并采用临时文件 + rename 原子替换。
- 后端拒绝同会话并行 ask，检测摘要陈旧写入和回答落盘前会话删除。
- Provider URL、天气网络、输入长度和生产 5xx 有显式边界。
- 架构、功能、迁移和测试文档更新为 React-only。

## R8.8 交付边界

- 生产启动默认从 `client/dist` 同源提供 React 页面和静态资源。
- API 统一为 `/api/*`；生产不保留可能遮蔽 SPA 的根路径 API。
- HTTPS 证书、私钥、有效期和密钥匹配在监听端口前验证。
- 证书与构建路径均由环境配置集中管理，并支持 `~/` 展开。
- API 404 不回退 HTML，非 GET 导航不回退，hash assets 和 HTML 使用不同缓存策略。
- 当前证书仅用于本机/局域网；公开互联网仍不属于产品范围。

## R8.9 交付边界

- client/server 都从根 pnpm catalog 解析 TypeScript 7.0.2，不再分别维护 6.x/7.x。
- 通用编译约束集中在 `tsconfig.base.json`，浏览器和 NodeNext 差异保持在子配置。
- 依赖安装和 lockfile 收口到仓库根 workspace。
- Express 升级到 5.2.1，同步升级 Express 5 类型及 debug/http-errors 等配套依赖。
- 生产依赖以根 `pnpm run audit:production` 为单一审计入口。

## 维护规则

1. 新问题先复现并加最小回归，再修复。
2. UI/流式/存储行为以可测量断言为准，不以截图代替。
3. 默认使用 mock、fixture、临时 file/SQLite；真实模型需明确确认。
4. 依赖升级必须通过 typecheck、lint、unit、build 和受影响 CDP。
5. Provider 特有逻辑留在 adapter；工具和存储保持现有模块边界。
6. 重要模型/上下文实验记录到 `docs/experiments.md`。

## 非目标

- 用户登录、权限和多用户数据隔离。
- 管理后台、商业计费和面向公众的大规模部署平台能力。
- 通用多模型网关、复杂观测平台或 Agent 平台化。

任何新 roadmap 项目必须先说明对个人使用或学习的直接价值，并由用户明确恢复“增加功能”的授权。

最终门禁、修复项和剩余边界见 [阶段交付审查（2026-08-09）](release-readiness-2026-08-09.md)。
