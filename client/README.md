# React 客户端

`client/` 是项目唯一前端，技术基线为 React 19 + TypeScript 7 + Vite 8。

## UI 与工具链

- Tailwind CSS 4：业务布局、状态和响应式 utilities。
- shadcn/ui Base UI：Button、Input、Textarea、Dialog、DropdownMenu。
- Lucide React：唯一通用图标库。
- Oxlint + tsgolint：普通和类型感知 lint。
- Vitest + Testing Library + jsdom：unit/component/hook 测试。
- markdown-it + DOMPurify + highlight.js：安全 Markdown 与完成态高亮。

全局 CSS 只保留 theme tokens、基础/滚动、Markdown/代码块和 reduced-motion；业务组件样式优先使用 Tailwind。

## 命令

依赖、TypeScript 7.0.2 catalog 和 lockfile 由仓库根 workspace 统一管理；先在仓库根目录安装：

```bash
pnpm install --frozen-lockfile
pnpm --dir client dev
pnpm --dir client typecheck
pnpm --dir client lint
pnpm --dir client test:unit
pnpm --dir client build
```

开发服务器监听 `0.0.0.0:5173`，`/api` 原样代理到 `http://127.0.0.1:7001`。生产环境不运行 Vite，由 Express 同源托管 `dist/`；见 [`../docs/production-deployment.md`](../docs/production-deployment.md)。

## 模块

```text
src/app/          页面组合
src/auth/         内存 Access Token、Refresh 单飞、401 重放和跨标签页同步
src/components/   业务与 UI primitives
src/hooks/        会话、流、搜索、滚动、主题和本地模板生命周期
src/reducers/     conversation/stream 纯状态
src/api/          HTTP 与 NDJSON reader
src/utils/        Markdown、协议、模型目录、内置/自定义模板 schema
../tests/client/  React unit/component/hook 测试及 Vitest setup
```

## 用户资料

姓名和头像由后端 `/api/runtime-config` 下发，组件不写死：

```dotenv
APP_PROFILE_NAME=Jason Wang
APP_PROFILE_AVATAR_URL=/assets/jw.svg
```

头像文件位于 `public/assets/`。
