---
name: "docker"
pack: "@Topia/devops"
description: "Dockerfile and docker-compose patterns — multi-stage builds, layer optimization, security hardening, development vs production configs."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# docker

Dockerfile and docker-compose patterns — multi-stage builds, layer optimization, security hardening, development vs production configs.

#### Workflow

**Step 1 — Detect container configuration**
Use Glob to find `Dockerfile*`, `docker-compose*.yml`, `.dockerignore`. Read each file to understand: base images used, build stages, exposed ports, volume mounts, environment variables, and health checks.

**Step 2 — Audit against best practices**
Check for: non-multi-stage builds (large images), `npm install` without `--omit=dev` in production stage, missing `.dockerignore` (bloated context), running as root (security risk), `latest` tag on base images (non-reproducible), missing `HEALTHCHECK`, `COPY . .` before dependency install (cache invalidation). Flag each with severity and fix.

**Step 3 — Emit optimized Dockerfile**
Rewrite or patch the Dockerfile: multi-stage build (deps → build → production), distroless or Alpine final image, non-root user, pinned base image versions, proper layer ordering, health check, and `.dockerignore` covering `node_modules`, `.git`, `*.md`.

#### Example

```dockerfile
# BEFORE: single stage, root user, no cache optimization
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3000
CMD ["node", "server.js"]

# AFTER: multi-stage, non-root, optimized layers
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
```
