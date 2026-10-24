# ── Stage 1: Build Svelte frontend ──────────────────────────────────────────
# fork (Suslicke/nutritrace): OpenAI Codex CLI for AI_PROVIDER=codex-cli (server/lib/codex-cli.js).
# Pinned release + SHA-256 of its archives (same as Checkist's recognition image); change the five
# values together. codex-code-mode-host must sit next to codex or every answer is invalid.
ARG CODEX_VERSION=0.162.0
ARG CODEX_SHA256_AMD64=8daf67f6261161aa5939d8d42a516032d760406216779d7ce6040f242140ff73
ARG CODEX_SHA256_ARM64=15162a9b59edf8e512b27414ec0b7db22e6424a1262b0eee8666643e0d295c2f
ARG CODEX_HOST_SHA256_AMD64=dee8bf3df637c68e1495b928d643b76d4ad44f94e4f0ed79fe8482fa79e23d97
ARG CODEX_HOST_SHA256_ARM64=18d99b055d2ef4a2af51f1144919bd8a208f4f79ace389b7775341d6903cf7e9

FROM scratch AS codex-amd64
ARG CODEX_VERSION
ARG CODEX_SHA256_AMD64
ARG CODEX_HOST_SHA256_AMD64
ADD --checksum=sha256:${CODEX_SHA256_AMD64} https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-x86_64-unknown-linux-musl.tar.gz /codex.tar.gz
ADD --checksum=sha256:${CODEX_HOST_SHA256_AMD64} https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz /host.tar.gz

FROM scratch AS codex-arm64
ARG CODEX_VERSION
ARG CODEX_SHA256_ARM64
ARG CODEX_HOST_SHA256_ARM64
ADD --checksum=sha256:${CODEX_SHA256_ARM64} https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-aarch64-unknown-linux-musl.tar.gz /codex.tar.gz
ADD --checksum=sha256:${CODEX_HOST_SHA256_ARM64} https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-code-mode-host-aarch64-unknown-linux-musl.tar.gz /host.tar.gz

FROM codex-${TARGETARCH} AS codex-archive

FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# scripts/postinstall.cjs is referenced by the "postinstall" npm hook, so it
# must exist before npm install runs. Copy it explicitly here so we don't
# bust the rest of the source-code Docker layer cache on every change.
COPY scripts/ ./scripts/
RUN npm install
COPY . .
RUN npm run build

# ── Stage 2: Express server + static frontend ────────────────────────────────
# Debian-slim base (not Alpine) — the @duckdb/node-bindings-linux-* native
# libraries used by the OFF mirror feature are glibc-linked and won't load
# on musl-based images. On Alpine, DuckDB fails with "Error loading shared
# library ld-linux-*.so.2: No such file or directory" because the glibc
# dynamic linker isn't present. DuckDB does not ship a musl variant of
# those node bindings, so a glibc base is required.
#
# Multi-arch note: this image builds for both linux/amd64 and linux/arm64
# (Raspberry Pi 4 / 5). npm picks the right @duckdb/node-bindings-linux-<arch>
# automatically during install based on the build platform.
FROM node:20-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json ./
RUN npm install --omit=dev
# fork: Web Push sender, outside package.json so upstream lockfile changes never conflict
RUN npm install --omit=dev --no-save web-push@3.6.7
# fork: Codex CLI + bubblewrap (the sandbox of `codex -s read-only`) + ca-certificates (node:20-slim has
# none; Node brings its own, Codex reads the system's) for AI_PROVIDER=codex-cli.
RUN --mount=type=bind,from=codex-archive,source=/codex.tar.gz,target=/tmp/codex.tar.gz \
    --mount=type=bind,from=codex-archive,source=/host.tar.gz,target=/tmp/host.tar.gz \
    apt-get update && apt-get install -y --no-install-recommends bubblewrap ca-certificates && rm -rf /var/lib/apt/lists/* \
 && mkdir /tmp/c && tar -xzf /tmp/codex.tar.gz -C /tmp/c && tar -xzf /tmp/host.tar.gz -C /tmp/c \
 && install -m 0755 /tmp/c/codex-code-mode-host-*-unknown-linux-musl /usr/local/bin/codex-code-mode-host \
 && rm /tmp/c/codex-code-mode-host-*-unknown-linux-musl \
 && install -m 0755 /tmp/c/codex-*-unknown-linux-musl /usr/local/bin/codex && rm -rf /tmp/c
COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
COPY server/ .
COPY --from=build /app/dist ./dist
# The MCP daily-totals tool reuses the shared Nutrition module that also
# powers the Svelte frontend (source of truth for exploded-recipe / legacy
# item summing). Its relative import climbs out of /app/lib/mcp/tools to
# /src/lib/nutrition.js — mirror that path in the container so local dev
# and Docker resolve the same file without a re-export shim.
COPY src/lib/nutrition.js /src/lib/nutrition.js
# Same arrangement for the Sleep Quality walk: Google Health derives it on
# the server, Health Connect on the phone, from this one file (#236).
# scripts/docker-src-imports.test.js fails if a server import of src/lib has
# no COPY line here.
COPY src/lib/sleep-quality.js /src/lib/sleep-quality.js
# Coaching resolves a client's targets for a day the way their Diary does.
COPY src/lib/goal-resolver.js /src/lib/goal-resolver.js
# Coaching checks a coach's recommended targets with the app's own rules.
COPY src/lib/coach-targets.js /src/lib/coach-targets.js
COPY src/lib/coach-plans.js /src/lib/coach-plans.js
# The weekly summary covers a week the way the app counts one (#232).
COPY src/lib/week.js /src/lib/week.js
# Also ship the root package.json so the server can read APP_VERSION from
# it at runtime when TRACEAPPS_APP_VERSION isn't injected via ARG below.
# Keeps versioning working even for builds that don't pass the build-arg.
COPY --from=build /app/package.json ./package.json
# Bake the app version into the image so the in-app updates checker can
# report the running server version. CI can pass `--build-arg
# APP_VERSION=$(node -p 'require("./package.json").version')`; falls
# back to reading /app/package.json at runtime.
ARG APP_VERSION=""
ENV TRACEAPPS_APP_VERSION=${APP_VERSION}
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "index.js"]
