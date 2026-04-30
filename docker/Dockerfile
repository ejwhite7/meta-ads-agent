# =============================================================================
# meta-ads-agent — Multi-stage Docker build
# =============================================================================

# --- Stage 1: Install dependencies ---
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/core/package.json ./packages/core/
COPY packages/meta-client/package.json ./packages/meta-client/
COPY packages/cli/package.json ./packages/cli/
RUN pnpm install --frozen-lockfile --prod=false

# --- Stage 2: Build ---
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/
COPY . .
RUN pnpm build

# --- Stage 3: Production ---
FROM node:20-alpine AS runner

# Install Python for meta-ads CLI
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --break-system-packages meta-ads

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/tsconfig ./packages/tsconfig
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/meta-client/package.json ./packages/meta-client/
COPY --from=builder /app/packages/meta-client/dist ./packages/meta-client/dist
COPY --from=builder /app/packages/cli/package.json ./packages/cli/
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=deps /app/node_modules ./node_modules

# Production env defaults
ENV NODE_ENV=production
ENV DATABASE_MODE=postgres
ENV DASHBOARD_PORT=3000

EXPOSE 3000

CMD ["node", "packages/cli/dist/index.js", "start"]
