FROM node:20-bookworm-slim AS web

WORKDIR /workspace
ENV COREPACK_INTEGRITY_KEYS=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/ ./apps/
COPY packages/ ./packages/
RUN corepack enable \
    && corepack pnpm install --frozen-lockfile \
    && corepack pnpm --filter @lvd/designer build \
    && corepack pnpm --filter @lvd/build-worker build \
    && corepack pnpm --filter @lvd/preview-host build

FROM python:3.11-slim AS runtime

WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake ninja-build \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/
COPY packages/schema/schema/ ./packages/schema/schema/
COPY packages/lvgl-runtime/dist/build-manifest.json ./packages/lvgl-runtime/dist/build-manifest.json
COPY vendor/lvgl/ ./lvgl-source/
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web /workspace/apps/designer/dist/ ./apps/designer/dist/
COPY --from=web /workspace/apps/build-worker/dist/ ./apps/build-worker/dist/
COPY --from=web /workspace/apps/preview-host/dist/ ./apps/preview-host/dist/

ENV AUTH_DATA_DIR=/workspace/auth_data \
    LVGL_DATA_DIR=/workspace/lvgl_data \
    LVD_STATIC_DIR=/workspace/apps/designer/dist \
    LVGL_BUILD_WORKER_PATH=/workspace/apps/build-worker/dist/lvgl-build-worker.mjs \
    LVGL_HOST_SOURCE_DIR=/workspace/lvgl-source \
    LVGL_CMAKE_BINARY=/usr/bin/cmake \
    LVGL_BUILD_COMPILE_GATE=host

EXPOSE 8001
CMD ["python", "-m", "uvicorn", "app:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8001"]
