---
name: "ci-cd"
pack: "@Topia/devops"
description: "CI/CD pipeline configuration — GitHub Actions, GitLab CI, build matrices, test parallelization, deployment gates, semantic release."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# ci-cd

CI/CD pipeline configuration — GitHub Actions, GitLab CI, build matrices, test parallelization, deployment gates, semantic release.

#### Workflow

**Step 1 — Detect existing pipeline**
Use Glob to find `.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`, `bitbucket-pipelines.yml`. Read each config to understand: triggers, jobs, caching strategy, test execution, deployment steps, and secrets usage.

**Step 2 — Audit pipeline efficiency**
Check for: no dependency caching (slow installs every run), sequential jobs that could parallelize, missing test matrix for multiple Node/Python versions, no deployment gates (staging → production), secrets referenced without environment protection, missing artifact upload for build outputs. Flag with estimated time savings.

**Step 3 — Emit optimized pipeline**
Rewrite or patch the pipeline: dependency caching (npm/pnpm/pip cache), parallel job graph (lint + typecheck + test), build matrix for LTS versions, deployment gates with manual approval for production, status checks required before merge, artifact persistence for deploy stage.

#### Example

```yaml
# GitHub Actions — optimized Node.js pipeline
name: CI/CD
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

jobs:
  quality:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        check: [lint, typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci
      - run: npm run ${{ matrix.check }}

  build:
    needs: quality
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci && npm run build
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: dist/ }

  deploy-staging:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/download-artifact@v4
        with: { name: dist }
      - run: echo "Deploy to staging..."

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production  # requires manual approval
    steps:
      - uses: actions/download-artifact@v4
        with: { name: dist }
      - run: echo "Deploy to production..."
```
