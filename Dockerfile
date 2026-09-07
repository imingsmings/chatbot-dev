# Bun 版本与仓库 packageManager、.bun-version 保持一致。
ARG BUN_VERSION=1.4.0

# 安装完整 workspace 依赖，只用于校验并构建 React 客户端。
FROM oven/bun:${BUN_VERSION}-slim AS build-dependencies

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY client/package.json client/package.json
COPY bun-server/package.json bun-server/package.json

RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# 客户端构建阶段不进入最终运行镜像。
FROM build-dependencies AS build

COPY client client
COPY shared shared
COPY tests/client tests/client

RUN bun run build:client

# 单独解析 Bun 后端的生产依赖闭包，排除前端和根开发依赖。
FROM oven/bun:${BUN_VERSION}-slim AS production-dependencies

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY client/package.json client/package.json
COPY bun-server/package.json bun-server/package.json

RUN --mount=type=cache,id=bun-production-install-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --filter bun-server

# 最终镜像只包含 Bun、后端源码、生产依赖、静态构建和运维工具。
FROM oven/bun:${BUN_VERSION}-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=7001
ENV SERVE_CLIENT_BUILD=true
ENV CLIENT_DIST_DIR=/app/client/dist
ENV HTTPS_ENABLED=true
ENV HTTPS_CERT_PATH=/tmp/chatbot-tls/server-cert.pem
ENV HTTPS_KEY_PATH=/tmp/chatbot-tls/server-key.pem
ENV CONVERSATION_DATA_DIR=/app/data
ENV CONVERSATION_STORE=sqlite

WORKDIR /app

COPY package.json package.json
COPY bun-server bun-server
COPY shared shared
COPY --from=production-dependencies /app/node_modules node_modules
COPY --from=production-dependencies /app/bun-server/node_modules bun-server/node_modules
COPY --from=build /app/client/dist client/dist
COPY docker/entrypoint.sh /usr/local/bin/chatbot-entrypoint
COPY docker/healthcheck.ts /app/docker/healthcheck.ts
COPY docker/volume-manifest.mjs /app/docker/volume-manifest.mjs

RUN mkdir -p /app/data \
    && chown bun:bun /app/data \
    && chmod 0755 /usr/local/bin/chatbot-entrypoint

EXPOSE 7001

# entrypoint 先复制只读 TLS 文件，再把应用进程降权为内置 bun 用户。
ENTRYPOINT ["chatbot-entrypoint"]
CMD ["bun", "bun-server/bin/www.ts"]
