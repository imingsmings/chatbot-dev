# 使用精简版 Node.js 22 Debian 镜像作为 pnpm 构建阶段的公共基础。
FROM node:22-bookworm-slim AS pnpm-base

# 指定 pnpm 通过 Corepack 安装后的主目录。
ENV PNPM_HOME=/pnpm
# 将 pnpm 可执行文件目录加入 PATH，供后续阶段直接调用。
ENV PATH=$PNPM_HOME:$PATH

# 启用 Corepack，并固定使用与项目 packageManager 声明一致的 pnpm 版本。
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

# 从 pnpm 基础阶段创建只负责安装依赖和构建前端的 build 阶段。
FROM pnpm-base AS build

# 将构建阶段的工作目录固定为 /app。
WORKDIR /app

# 先复制根工作区清单、锁文件和共享 TypeScript 配置，以利用依赖安装缓存。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# 复制客户端 package 清单，让 pnpm 能解析 client workspace 依赖。
COPY client/package.json client/package.json
# 复制服务端 package 清单，让 pnpm 能完整解析 workspace 和锁文件。
COPY server/package.json server/package.json

# 使用 BuildKit 缓存复用 pnpm store，减少重复下载。
# 按锁文件精确安装全部构建依赖，锁文件不一致时直接失败。
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=cache,id=pnpm-metadata,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile

# 复制 React 客户端源码和 Vite 配置。
COPY client client
# 复制服务端源码，保留构建阶段的完整工作区结构。
COPY server server
# 复制前后端共同使用的轻量应用协议定义。
COPY shared shared
# 复制客户端测试类型文件，因为客户端 TypeScript 构建配置会校验这些文件。
COPY tests/client tests/client

# 执行客户端类型检查并生成 client/dist 生产静态文件。
RUN pnpm run build:client

# 创建只负责解析服务端生产依赖的阶段，不把 pnpm 或下载缓存带入运行镜像。
FROM pnpm-base AS production-dependencies

# 将生产依赖阶段的工作目录固定为 /app。
WORKDIR /app

# 复制 workspace 清单和锁文件，以解析 server 的生产依赖闭包。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json

# pnpm store 和元数据均使用 BuildKit cache mount，只将最终 node_modules 留在本阶段。
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=cache,id=pnpm-metadata,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --prod --filter server

# 从原始 Node 镜像重新创建运行阶段，避免继承 Corepack、pnpm 和 root 下载缓存。
FROM node:22-bookworm-slim AS runtime

# 显式安装卷备份和恢复脚本依赖的 tar，避免依赖基础镜像的隐式工具集合。
RUN apt-get update \
    && apt-get install -y --no-install-recommends tar \
    && rm -rf /var/lib/apt/lists/*

# 让 Express、依赖和错误处理按生产模式运行。
ENV NODE_ENV=production
# 监听全部容器网络接口，使 Docker 端口映射和局域网访问生效。
ENV HOST=0.0.0.0
# 设置容器内 Node HTTPS 服务端口。
ENV PORT=7001
# 启用 Express 对已构建 React 静态文件的同源托管。
ENV SERVE_CLIENT_BUILD=true
# 指定容器内 React 生产构建目录。
ENV CLIENT_DIST_DIR=/app/client/dist
# 启用 Node 原生 HTTPS，由 Express 进程直接终止 TLS。
ENV HTTPS_ENABLED=true
# 指向 entrypoint 从只读挂载复制出的容器内证书文件。
ENV HTTPS_CERT_PATH=/tmp/chatbot-tls/server-cert.pem
# 指向 entrypoint 从只读挂载复制出的容器内私钥文件。
ENV HTTPS_KEY_PATH=/tmp/chatbot-tls/server-key.pem
# 将会话数据根目录固定到 Docker volume 挂载点。
ENV CONVERSATION_DATA_DIR=/app/data
# 默认使用 SQLite 保存会话数据。
ENV CONVERSATION_STORE=sqlite

# 将运行阶段的工作目录固定为 /app。
WORKDIR /app

# 复制根 package 清单，保留 shared TypeScript 模块的 ESM 运行边界。
COPY package.json package.json
# 复制服务端 TypeScript 源码和运行配置。
COPY server server
# 复制服务端运行时导入的共享应用协议定义。
COPY shared shared
# 从独立依赖阶段复制 server 生产依赖，不在运行镜像中执行 pnpm。
COPY --from=production-dependencies /app/node_modules node_modules
COPY --from=production-dependencies /app/server/node_modules server/node_modules
# 从 build 阶段复制 React 生产构建，不复制 build 阶段的依赖目录。
COPY --from=build /app/client/dist client/dist
# 安装容器启动脚本，用于复制 TLS 文件并将应用进程降权到 node 用户。
COPY docker/entrypoint.sh /usr/local/bin/chatbot-entrypoint
# 复制只读卷清单工具，供宿主机备份和恢复脚本校验数据树。
COPY docker/volume-manifest.mjs /app/docker/volume-manifest.mjs

# 创建 volume 挂载点，确保 node 用户拥有数据目录，并赋予 entrypoint 可执行权限。
RUN mkdir -p /app/data \
    && chown node:node /app/data \
    && chmod 0755 /usr/local/bin/chatbot-entrypoint

# 声明容器内服务监听 7001；实际宿主机端口仍由 Compose ports 决定。
EXPOSE 7001

# 固定先执行启动脚本，完成 TLS 文件权限处理和应用进程降权。
ENTRYPOINT ["chatbot-entrypoint"]
# 默认启动 Express HTTPS 服务；该命令可在运行容器时被覆盖。
CMD ["node", "server/bin/www.ts"]
