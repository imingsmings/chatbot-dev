# 文档索引

本文按文档生命周期组织入口。阅读当前实现时优先使用“当前规范”；带日期的方案、验收和历史记录只证明当时范围，不能替代当前源码、配置与测试矩阵。

## 当前规范

| 文档 | 责任边界 |
| --- | --- |
| [README](../README.md) | 项目定位、快速启动、配置入口和常用命令 |
| [架构](architecture.md) | 当前模块边界、数据流、时序、存储与扩展约束 |
| [功能清单](features.md) | 已交付能力与明确不包含的产品边界 |
| [流式协议 v2](streaming-protocol.md) | Provider SSE、应用 NDJSON、工具事件、取消与演进规则 |
| [回归测试矩阵](regression-test-cases.md) | 当前测试入口、断言范围、真实接口授权与清理规则 |
| [生产部署](production-deployment.md) | Node HTTPS 非容器部署 |
| [Docker 局域网部署](docker-deployment.md) | 单容器、TLS、SQLite Volume、备份恢复与迁移 |
| [R23 Provider-aware 上下文预算](r23-provider-aware-context-budget-2026-08-29.md) | 模型上限、统一估算、裁剪顺序、上下文预览与验证证据 |
| [R22 请求一致性与原子导入](r22-request-consistency-atomic-import-2026-08-29.md) | requestId 幂等、断线恢复、file/SQLite/附件批次事务与验证证据 |
| [P1 工程可靠性优化](engineering-hardening-2026-08-31.md) | 取消完成协调、liveness/readiness、Provider 安全诊断与当前非 Docker 验收证据 |
| [Roadmap](roadmap.md) | 当前基线、候选范围、选择与实施授权规则 |
| [实验记录](experiments.md) | 可重复模型、上下文、工具与渲染实验 |

当描述冲突时，源码和可重复测试是行为依据；项目方向以 Roadmap 为准；部署操作以对应部署文档为准。

## 已完成方案与验收

这些文档记录设计取舍、验收证据和回滚边界。它们不会随着每次实现调整持续重写。

- [R11 流完整性与摘要覆盖](r11-stream-context-2026-08-12.md)
- [R12 生成元数据](r12-generation-metadata-2026-08-12.md)
- [R13 维护性拆分](r13-maintainability-2026-08-12.md)
- [R14 Docker 运维](r14-docker-operations-2026-08-12.md)
- [R15 消息分支](r15-message-branching-2026-08-12.md)
- [R16 全链路一致性](r16-consistency-hardening-2026-08-13.md)
- [R17 会话级模型配置验收](r17-conversation-model-options-2026-08-13.md)
- [R18 自定义 Prompt 模板](r18-custom-prompt-templates-2026-08-13.md)
- [R19 流式渲染与快速到底](r19-streaming-rendering-2026-08-13.md)
- [R20 JWT 单用户认证](r20-jwt-authentication-plan.md)
- [R21 图片附件与多模态理解方案](r21-multimodal-vision-plan.md)
- [R21 图片附件与 Vision 验收记录](r21-multimodal-vision-2026-08-24.md)
- [R22 请求一致性与原子导入](r22-request-consistency-atomic-import-2026-08-29.md)
- [R23 Provider-aware 上下文预算](r23-provider-aware-context-budget-2026-08-29.md)
- [P1 工程可靠性优化](engineering-hardening-2026-08-31.md)
- [会话级模型配置持久化方案](conversation-model-options-plan.md)
- [流式渲染平滑度优化方案](streaming-rendering-optimization-plan.md)
- [DeepSeek V4 Pro 0813 启用与验收](deepseek-v4-pro-0813-validation-2026-08-13.md)

## 历史快照

以下内容用于追溯当时的架构、命令、模型、镜像和测试结果。部分 Vue 命令、模型名、计数、临时产物路径或镜像体积已经不属于当前基线。

- [Roadmap P0-R21 历史阶段记录](roadmap-history.md)
- [React 迁移收口记录](react-migration-plan.md)
- [Vue 迁移基线归档](react-migration-vue-baseline.md)
- [架构与 Code Review 记录（2026-05-23）](architecture-review-2026-05-23.md)
- [CDP 回归结果（2026-05-23）](cdp-regression-results-2026-05-23.md)
- [流式回答回归分析（2026-05-24）](streaming-regression-analysis-2026-05-24.md)
- [CDP 回归结果（2026-07-31）](cdp-regression-results-2026-07-31.md)
- [OpenAI Responses 回归结果（2026-08-02）](cdp-regression-results-2026-08-02-openai.md)
- [阶段交付审查（2026-08-09）](release-readiness-2026-08-09.md)
- [TypeScript 7 / Express 5 工具链升级](toolchain-upgrade-2026-08-09.md)
- [全面 Code Review 与回归记录（2026-08-10）](code-review-2026-08-10.md)
- [Docker 初始验证记录（2026-08-10）](docker-validation-2026-08-10.md)
- [R8.5 React 设计 QA](../design-qa.md)

历史记录中的测试通过只说明对应日期、代码和环境下的结果。当前交付结论应重新执行 [回归测试矩阵](regression-test-cases.md) 中与改动范围匹配的门禁。
