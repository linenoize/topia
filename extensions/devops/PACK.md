---
name: "@Topia/devops"
description: DevOps patterns — Docker, CI/CD pipelines, monitoring setup, server configuration, SSL/domain management, edge/serverless deployment, and infrastructure-as-code.
metadata:
  author: skill-topia
  version: "0.3.0"
  layer: L4
  price: "$12"
  target: DevOps engineers
  format: split
---

# @Topia/devops

## Purpose

Infrastructure work done without patterns leads to snowflake configs: Dockerfiles that rebuild entire node_modules on every code change, CI pipelines that run 40 minutes because nothing is cached, servers with no monitoring until the first outage, SSL certificates that expire silently, serverless functions that leak state across requests, and infrastructure provisioned by hand that can't be reproduced. This pack provides battle-tested patterns for containerization, continuous delivery, production observability, server hardening, edge/serverless deployment, and infrastructure-as-code — each skill detects what you have, audits it against best practices, and emits the fixed config.

## Triggers

- Auto-trigger: when `Dockerfile`, `docker-compose.yml`, `.github/workflows/`, `.gitlab-ci.yml`, `nginx.conf`, `Caddyfile` detected in project
- `/topia docker` — audit and optimize container configuration
- `/topia ci-cd` — audit and optimize CI/CD pipeline
- `/topia monitoring` — set up or audit production monitoring
- `/topia server-setup` — audit server configuration
- `/topia ssl-domain` — manage SSL certificates and domain config
- `/topia edge-serverless` — audit and configure edge/serverless deployment
- `/topia infra-as-code` — audit and structure Terraform/Pulumi/CDK infrastructure
- `/topia chaos-testing` — design and run resilience experiments
- `/topia kubernetes` — audit and emit production-ready Kubernetes manifests
- Called by `deploy` (L2) when deployment infrastructure needs setup
- Called by `launch` (L1) when preparing production environment

## Skills Included

| Skill | Model | Description |
|-------|-------|-------------|
| [docker](skills/docker.md) | sonnet | Dockerfile and docker-compose patterns — multi-stage builds, layer optimization, security hardening, development vs production configs. |
| [ci-cd](skills/ci-cd.md) | sonnet | CI/CD pipeline configuration — GitHub Actions, GitLab CI, build matrices, test parallelization, deployment gates, semantic release. |
| [monitoring](skills/monitoring.md) | sonnet | Production monitoring setup — Prometheus, Grafana, alerting rules, SLO/SLI definitions, log aggregation, distributed tracing. |
| [server-setup](skills/server-setup.md) | sonnet | Server configuration — Nginx/Caddy reverse proxy, systemd services, firewall rules, SSH hardening, automatic updates. |
| [ssl-domain](skills/ssl-domain.md) | sonnet | SSL certificate management and domain configuration — Let's Encrypt automation, DNS records, CDN setup, redirect rules. |
| [chaos-testing](skills/chaos-testing.md) | sonnet | Resilience testing — inject controlled failures to verify circuit breakers, retry logic, graceful degradation, and recovery procedures. |
| [kubernetes](skills/kubernetes.md) | sonnet | Kubernetes resource patterns — Deployments, Services, ConfigMaps, resource limits, health probes, HPA, network policies, and RBAC. |
| [edge-serverless](skills/edge-serverless.md) | sonnet | Edge and serverless deployment patterns — Cloudflare Workers, Vercel Edge Functions, AWS Lambda, Deno Deploy. Runtime constraints, cold starts, streaming, state management. |
| [infra-as-code](skills/infra-as-code.md) | sonnet | Infrastructure-as-Code patterns — Terraform, Pulumi, and CDK. State management, module organization, secret handling, drift detection, CI/CD integration. |

## Tech Stack Support

| Platform | Container | CI/CD | Reverse Proxy |
|----------|-----------|-------|---------------|
| AWS (EC2/ECS/Lambda) | Docker | GitHub Actions | Nginx / ALB |
| GCP (Cloud Run/GKE) | Docker | Cloud Build / GitHub Actions | Caddy / Cloud LB |
| Vercel | Serverless | Built-in | Built-in |
| DigitalOcean (Droplet/App Platform) | Docker | GitHub Actions | Nginx / Caddy |
| VPS (any) | Docker | GitHub Actions (self-hosted) | Nginx / Caddy |
| Cloudflare Workers | Wrangler | GitHub Actions / Wrangler deploy | Workers Routes |
| Deno Deploy | Deno runtime | deployctl / GitHub Actions | Built-in |
| Fly.io | Docker/Firecracker | flyctl / GitHub Actions | Fly Proxy |

## Connections

```
Calls → verification (L3): validate configs syntax and test infrastructure changes
Calls → sentinel (L2): security audit on server and container configuration
Calls → sentinel-env (L3): edge-serverless validates runtime prerequisites before deployment
Called By ← deploy (L2): deployment infrastructure setup
Called By ← launch (L1): production environment preparation
Called By ← build (L1): when DevOps task detected
Called By ← scaffold (L1): infra-as-code generates infrastructure alongside project bootstrap
edge-serverless → docker: containerized apps may deploy to serverless container platforms (Cloud Run, Fly.io)
infra-as-code → ci-cd: IaC changes flow through CI/CD with plan-and-apply pipeline
infra-as-code → monitoring: IaC provisions monitoring infrastructure (alerts, dashboards)
```

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Docker multi-stage build references wrong stage name causing empty final image | HIGH | Validate `COPY --from=` stage names match defined stages; emit build test command |
| CI caching key uses lockfile that doesn't exist (e.g., `pnpm-lock.yaml` when using npm) | HIGH | Detect actual package manager from lockfile presence before emitting cache config |
| Monitoring metrics have high cardinality labels (user ID as label) causing Prometheus OOM | CRITICAL | Constrain label values to bounded sets (method, route, status) — never use IDs as labels |
| SSH hardening locks out user (key-only auth before key is added) | CRITICAL | Emit config change AND key setup in correct order; include rollback instructions |
| SSL certificate renewal fails silently after initial setup | HIGH | Emit renewal test command (`certbot renew --dry-run`) and cron verification |
| Nginx config syntax error takes down production proxy | HIGH | Always emit `nginx -t` test command before reload; suggest blue-green proxy config |

## Done When

- Dockerfile emits multi-stage, non-root, health-checked, layer-optimized build
- CI/CD pipeline has caching, parallelization, deployment gates, and status checks
- Monitoring covers RED metrics, structured logging, and SLO-based alerting
- Server hardened: key-only SSH, firewall, security headers, rate limiting
- SSL automated with renewal verification
- Edge/serverless config audited: no anti-patterns (floating promises, global state, unbounded buffering), correct platform bindings, streaming patterns applied
- IaC structured: remote state with locking, modular layout, environment separation, CI/CD pipeline for plan/apply, `prevent_destroy` on critical resources
- All emitted configs tested with syntax validation commands
- Structured report emitted for each skill invoked

## Cost Profile

~16,000–28,000 tokens per full pack run (all 9 skills). Individual skill: ~2,000–4,500 tokens. Sonnet default. Use haiku for config detection scans; escalate to sonnet for config generation and security audit.
