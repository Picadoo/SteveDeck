# syntax=docker/dockerfile:1
# ===================== 构建阶段 =====================
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# 先拷贝各包清单，最大化利用层缓存
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/engine/package.json ./packages/engine/
COPY packages/ui/package.json ./packages/ui/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/mobile/package.json ./apps/mobile/

# 补丁文件（pnpm patchedDependencies 需要，否则 install 报 ENOENT）
COPY patches ./patches/

# 仅安装引擎及其依赖（含 protocol）
RUN pnpm install --frozen-lockfile --filter @mcbot/engine...

# 拷贝源码并构建 protocol → engine
COPY packages/protocol ./packages/protocol
COPY packages/engine ./packages/engine
RUN pnpm --filter @mcbot/protocol build && pnpm --filter @mcbot/engine build

# 生成自包含部署目录（仅生产依赖）
RUN pnpm --filter @mcbot/engine deploy --prod /app/deploy

# ===================== 运行阶段 =====================
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV MCBOT_DATA_DIR=/data
ENV PORT=8723

COPY --from=build /app/deploy /app
RUN mkdir -p /data

EXPOSE 8723
VOLUME ["/data"]

# 健康检查（Node 22 自带 fetch）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8723) +'/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/bin/serve.js"]
