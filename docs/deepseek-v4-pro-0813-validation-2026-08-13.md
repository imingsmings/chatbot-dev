# DeepSeek V4 Pro 0813 启用与验收记录

日期：2026-08-13

## 结论

- DeepSeek 官方模型与价格页显示，`deepseek-v4-pro` 当前对应 `DeepSeek-V4-Pro-0813`。
- 本机运行配置已从 `LLM_DISABLED_MODELS` 中移除 `deepseek-v4-pro`，继续禁用 `gpt-5.6-sol`。
- UI Mock 已确认 V4 Pro 可选择、GPT-5.6 Sol 不可选择；后端已有的通用禁用模型校验继续保留。
- 真实接口已覆盖 V4 Pro 驱动的 UI、上下文、Markdown，以及 Flash/Pro × Off/Low/Medium/High 共 8 组模型参数组合。
- Docker 已用最新工作区重建；健康检查为 200，运行时目录显示 V4 Pro 已启用，部署前后会话数均为 7。

官方依据：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>

## 变更边界

- 运行时只解除 `deepseek-v4-pro` 禁用，没有改成默认模型；默认仍为 `deepseek-v4-flash`。
- 应用侧 `maxTokens` 上限仍保持 65536，没有随官方最大输出 384K 自动放大。
- 没有改变模型 ID、Provider 协议、NDJSON v2、持久化 schema 或 Docker 数据卷。
- R16 验收记录中的“V4 Pro 当时未发送真实请求”是历史事实，不回写修改。

## 自动化验证

以下命令均通过：

```text
pnpm run check
pnpm run test:unit
pnpm run build:client
CDP_SCREENSHOTS=0 pnpm run test:cdp:all-mock
CDP_SCREENSHOTS=0 CDP_REAL_SCRIPT_RETRIES=0 pnpm run test:cdp:all-real
```

关键结果：

- Server：114/114。
- Client：18 个测试文件，71/71。
- 全量 Mock：13 个 CDP 脚本通过，无截图。
- 真实主套件：V4 Pro UI、上下文、Markdown 与 OpenAI Responses 全部通过。
- 真实模型参数：Flash/Pro × Off/Low/Medium/High，8/8 通过；逐组断言请求模型、reasoning 开关/强度、reasoning 有无、响应标记和 UI 错误状态。
- 测试使用随机端口、临时 file store 和临时 Chrome profile；测试会话均在退出时删除。

## Docker 验收

- 新镜像：`sha256:8e95f0d2f971b21408bd74870cb684aebf5a159758046037e425c76342675f11`。
- 回滚标签：`chatbot:rollback-pre-v4-pro-20260813-0127`。
- 容器状态：running / healthy；`GET /api/health` 返回 200。
- `/api/runtime-config`：V4 Pro 存在且启用，GPT-5.6 Sol 仍禁用，默认模型仍为 V4 Flash。
- `/app/data` 继续使用 `chatbot_chatbot-data`；部署前后会话数均为 7。
- TLS 证书与私钥继续只读挂载；Node 应用进程 UID 为 1000。
