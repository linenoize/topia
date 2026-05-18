# Topia Skill & Extension Categories

This document provides a categorized overview of all skills and extensions available in Topia. Use this to understand which tools are best suited for your current task.

---

## 🛠️ Core Development & Code Workflow
These tools are the primary drivers for implementing features, fixing bugs, and maintaining code quality.

| Skill | Purpose |
| :--- | :--- |
| `build` | **Orchestrator**: The default route for 70% of requests (also invoked via `/topia build`). Handles full TDD cycle: Understand → Plan → Test → Implement → Verify. |
| `fix` | **Action Hub**: Specialized in writing implementation code, applying bug fixes, and verifying with tests. |
| `debug` | **Root Cause Analysis**: Traces errors through code using structured reasoning and hands off to `fix`. |
| `test` | **TDD Specialist**: Writes failing tests first (red) and verifies they pass after implementation (green). |
| `scout` | **Fast Scanner**: Read-only codebase explorer used to find files, patterns, and dependencies. |
| `verification` | **Runner**: Executes linting, type-checks, tests, and builds to ensure nothing is broken. |
| `db` | **Database Specialist**: Manages migrations, rollback scripts, and validates queries. |
| `git` | **Utility**: Handles semantic commits, PR descriptions, and branch management. |
| `graft` | **Porter**: Clones or converts features from external GitHub repos into your project. |
| `surgeon` | **Refactorer**: Performs incremental surgery on legacy code using proven patterns (e.g., Strangler Fig). |
| `safeguard` | **Safety Net**: Builds characterization tests and rollback points before risky refactors. |
| `mcp-builder` | **Tool Builder**: Generates Model Context Protocol servers from specifications. |
| `scaffold` | **Bootstrapper**: 0 to production-ready in one pipeline — idea → plan → design → fix → test → docs → git. |
| `rescue` | **Modernizer**: Multi-session legacy refactoring orchestrator for messy codebases (health <40). |
| `improve-architecture` | **Architect**: Finds shallow modules and proposes deepening opportunities for testability. |

---

## 🛡️ Security, Governance & Infrastructure
Tools focused on keeping the codebase secure, compliant, and correctly deployed.

| Skill | Purpose |
| :--- | :--- |
| `sentinel` | **Gatekeeper**: Blocks unsafe code (secrets, OWASP Top 10) before commit. A hard gate. |
| `sentinel-env` | **Environment Audit**: Validates OS, runtimes, and tools before work starts. |
| `sast` | **Static Analysis**: Wraps ESLint, Semgrep, and other analyzers for deep code auditing. |
| `adversary` | **Red-Team**: Challenges high-risk plans before code is written to find security and logic holes. |
| `logic-guardian` | **Protector**: Prevents accidental deletion or corruption of critical business logic. |
| `quarantine` | **Advisory**: Treats tool output from untrusted surfaces (WebFetch, user-content) as raw data. |
| `hallucination-guard` | **AI Validator**: Verifies that AI-generated imports and API calls actually exist. |
| `deploy` | **Shipper**: Handles multi-platform deployment (Vercel, AWS, etc.) with health checks. |
| `watchdog` | **Monitor**: Verifies application health immediately after deployment. |
| `dependency-doctor` | **Health Check**: Scans for outdated packages and CVEs with a prioritized update plan. |
| `audit` | **Holistic Check**: Comprehensive audit across 8 dimensions (security, performance, etc.). |
| `preflight` | **Pre-Commit Gate**: Catches "almost right" code — logic correctness, error handling, regressions, completeness. |
| `perf` | **Perf Regression Gate**: Detects N+1 queries, sync-in-async, missing indexes, memory leaks, bundle bloat. |
| `incident` | **Responder**: Structured incident response — triage, contain, verify, root-cause, postmortem. |

---

## 🧠 Knowledge, Research & Strategy
Tools for gathering information, making decisions, and maintaining persistent project context.

| Skill | Purpose |
| :--- | :--- |
| `research` | **Explorer**: Performs web searches and knowledge lookups for technologies and best practices. |
| `docs` | **Documenter**: Maintains READMEs, API docs, architecture, and changelogs. |
| `docs-seeker` | **Finder**: Locates specific documentation for APIs, libraries, and error messages. |
| `onboard` | **Bootstrapper**: Generates `CLAUDE.md` and initial project context for AI sessions. |
| `problem-solver` | **Thinker**: Applies 19 analytical frameworks (e.g., McKinsey-grade) to complex problems. |
| `sequential-thinking` | **Logician**: Breaks interconnected decisions into ordered logical steps. |
| `journal` | **Persistence**: Tracks ADRs (Architecture Decision Records) and decisions across sessions. |
| `neural-memory` | **Memory**: Provides cross-session recall of patterns, insights, and semantic links. |
| `trend-scout` | **Market Watch**: Scans GitHub Trending, Product Hunt, etc., for emerging patterns. |
| `autopsy` | **Assessor**: Full health assessment of legacy codebases with rescue planning. |

---

## 📋 Planning & Management
Tools for structuring work, delegating tasks, and reviewing progress.

| Skill | Purpose |
| :--- | :--- |
| `plan` | **Architect**: Creates structured master plans and phase files for complex features. |
| `idea` | **Intake**: Elicits requirements and produces Requirements Documents. Searches and stores ideas in cross-session memory. |
| `brainstorm` | **Ideator**: Generates 2-3 approaches with trade-offs using SCAMPER / First Principles frameworks. |
| `documentation` | **Steward**: Generates leadership-ready packages, User Stories, and Jira-compliant CSV tickets. |
| `team` | **Orchestrator**: Decomposes tasks into parallel workstreams for multiple agents. |
| `review` | **Reviewer**: Audits code for quality, performance, and correctness patterns. |
| `review-intake` | **Intake**: Processes external PR feedback or issue tracker items into actionable briefs. |
| `retro` | **Historian**: Performs engineering retrospectives on commit history and work patterns. |
| `scope-guard` | **Control**: Detects and quantifies scope creep during implementation. |
| `context-pack` | **Packager**: Bundles task context for delegation to sub-agents without context loss. |
| `completion-gate` | **Verifier**: Validates that agent claims match the actual evidence trail. |

---

## 🎨 Creative & specialized Actions
Tools for generating assets, marketing, and special project types.

| Skill | Purpose |
| :--- | :--- |
| `asset-creator` | **Designer**: Creates SVG icons, OG images, banners, and icon sets. |
| `marketing` | **Growth**: Generates landing copy, SEO meta, blog posts, and video scripts. |
| `slides` | **Presenter**: Generates slide decks (Marp-compatible) from project context. |
| `video-creator` | **Director**: Plans video content with scripts, storyboards, and asset checklists. |
| `launch` | **Go-Live**: Orchestrates deployment combined with marketing asset creation. |
| `browser-pilot` | **Automation**: Performs browser-based interactions and accessibility audits. |
| `design` | **System Designer**: Maps product domain to style, palette, typography — generates `.topia/design-system.md`. |
| `doc-processor` | **Format Utility**: Generates and parses PDF, DOCX, XLSX, PPTX, CSV for reports and data exchange. |

---

## 🧩 Extension Packs (Plugins)
Specialized vertical patterns for specific application domains.

| Pack | Focus |
| :--- | :--- |
| `@Topia/ai-ml` | RAG pipelines, LLM integration, embeddings, and research loops. |
| `@Topia/backend` | API design, auth, database patterns, and background jobs. |
| `@Topia/ui` | Design systems, accessibility audits, and React architecture patterns. |
| `@Topia/mobile` | React Native, Flutter, OTA updates, and app store pipelines. |
| `@Topia/security` | Penetration testing patterns, supply chain security, and API hardening. |
| `@Topia/devops` | Docker, CI/CD, SSL/domain management, and IaaS. |
| | Multi-tenancy, billing, subscription flows, and feature flags. |
| `@Topia/ecommerce` | Shopify integration, payment gateways, and order lifecycles. |
| | WebGL, game loops, physics engines, and ECS architecture. |
| `@Topia/chrome-ext` | Manifest V3 scaffolding, service workers, and store compliance. |
| `@Topia/content` | CMS integration, MDX, i18n, and content scoring. |
| | Real-time data, technical indicators, and WebSocket architecture. |
| `@Topia/analytics` | Tracking setup, A/B testing, and funnel analysis. |
| | Zalo Official Account API and automation integration. |

---

## 🔧 Internal Mesh Tools
Internal primitives that power the Topia infrastructure.

| Tool | Purpose |
| :--- | :--- |
| `skill-router` | **Dispatcher**: The brain that routes every prompt to the correct specialized skill. |
| `skill-forge` | **Builder**: Tool for creating and verifying new Topia skills. |
| `context-engine` | **Manager**: Handles context compaction and window optimization. |
| `session-bridge` | **Bridge**: Universal persistence layer between session boundaries. |
| `worktree` | **Isolation**: Manages git worktrees for parallel development streams. |
| `integrity-check` | **Validator**: Verifies .topia/ files against poisoning or injection. |
| `constraint-check` | **HARD-GATE Auditor**: Verifies a skill's mandatory constraints were actually followed (not just claimed). |
