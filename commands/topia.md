---
description: "Topia skill ecosystem — interconnected workflows for the full project lifecycle. Use /topia <action> to invoke skills."
disable-model-invocation: true
---

# Topia — Less skills. Deeper connections.

Route to the appropriate Topia skill based on the action:

## Available Commands

### Orchestrators (L1)
- `/topia build <task>` — Invoke the Topia:build skill for feature implementation
- `/topia team <task>` — Invoke the Topia:team skill for parallel multi-agent work
- `/topia launch` — Invoke the Topia:launch skill for deploy + marketing
- `/topia rescue` — Invoke the Topia:rescue skill for legacy refactoring

### Workflow (L2) — Creation
- `/topia plan <task>` — Invoke the Topia:plan skill to create implementation plan
- `/topia scout` — Invoke the Topia:scout skill to scan codebase
- `/topia brainstorm <topic>` — Invoke the Topia:brainstorm skill for creative ideation

### Workflow (L2) — Development
- `/topia debug <issue>` — Invoke the Topia:debug skill for root cause analysis
- `/topia fix <issue>` — Invoke the Topia:fix skill to apply code changes
- `/topia test` — Invoke the Topia:test skill to write and run tests
- `/topia review` — Invoke the Topia:review skill for code quality review

### Workflow (L2) — Quality
- `/topia sentinel` — Invoke the Topia:sentinel skill for security scanning
- `/topia preflight` — Invoke the Topia:preflight skill for pre-commit quality gate
- `/topia onboard` — Invoke the Topia:onboard skill to generate project context
- `/topia logic-guardian` — Invoke the Topia:logic-guardian skill to protect business logic from accidental deletion

### Workflow (L2) — Delivery
- `/topia deploy` — Invoke the Topia:deploy skill for deployment management
- `/topia marketing` — Invoke the Topia:marketing skill for launch asset creation

### Workflow (L2) — Rescue
- `/topia autopsy` — Invoke the Topia:autopsy skill for codebase health assessment
- `/topia safeguard` — Invoke the Topia:safeguard skill to build safety nets for legacy code
- `/topia surgeon` — Invoke the Topia:surgeon skill for incremental refactoring

### Utilities (L3) — Knowledge
- `/topia research <topic>` — Invoke the Topia:research skill for web research
- `/topia docs-seeker <query>` — Invoke the Topia:docs-seeker skill for documentation lookup
- `/topia trend-scout <topic>` — Invoke the Topia:trend-scout skill for market intelligence

### Utilities (L3) — Reasoning
- `/topia problem-solver <problem>` — Invoke the Topia:problem-solver skill for structured reasoning
- `/topia sequential-thinking <problem>` — Invoke the Topia:sequential-thinking skill for multi-variable analysis

### Utilities (L3) — Validation
- `/topia verification` — Invoke the Topia:verification skill to run lint, type-check, tests, build
- `/topia hallucination-guard` — Invoke the Topia:hallucination-guard skill to verify imports and APIs

### Utilities (L3) — State
- `/topia context-engine` — Invoke the Topia:context-engine skill for context window management
- `/topia journal` — Invoke the Topia:journal skill for rescue state tracking
- `/topia session-bridge` — Invoke the Topia:session-bridge skill for cross-session persistence

### Utilities (L3) — Monitoring
- `/topia watchdog` — Invoke the Topia:watchdog skill for post-deploy monitoring
- `/topia scope-guard` — Invoke the Topia:scope-guard skill for scope creep detection

### Utilities (L3) — Media
- `/topia browser-pilot <url>` — Invoke the Topia:browser-pilot skill for Playwright automation
- `/topia asset-creator <brief>` — Invoke the Topia:asset-creator skill for visual asset generation
- `/topia video-creator <brief>` — Invoke the Topia:video-creator skill for video content planning

### Utilities (L3) — Deps
- `/topia dependency-doctor` — Invoke the Topia:dependency-doctor skill for dependency management

### Intelligence (H3)
- `/topia metrics` — Show mesh analytics from .topia/metrics/ (runs audit Phase 8 only)
- `/topia pack list` — List installed L4 packs (core + community)
- `/topia pack install <git-url>` — Install a community L4 pack from Git
- `/topia pack remove <name>` — Remove a community L4 pack
- `/topia pack create <name>` — Scaffold a new L4 pack using skill-forge

### Extension Packs (L4)

L4 packs provide domain-specific patterns. When invoked, read the pack's PACK.md and follow the matching skill's workflow steps.

#### Frontend & UI (`extensions/ui/PACK.md`)
- `/topia design-system` — Design token generation and enforcement
- `/topia component-patterns` — Component architecture refactoring
- `/topia a11y-audit` — Accessibility audit (WCAG compliance)
- `/topia animation-patterns` — Motion design and animation patterns

#### Backend (`extensions/backend/PACK.md`)
- `/topia api-patterns` — REST/GraphQL API design and validation
- `/topia auth-patterns` — Authentication and authorization flows
- `/topia database-patterns` — Schema design, migrations, query optimization
- `/topia middleware-patterns` — Middleware pipeline and error handling

#### DevOps (`extensions/devops/PACK.md`)
- `/topia docker` — Dockerfile optimization, multi-stage builds, compose
- `/topia ci-cd` — CI/CD pipeline setup (GitHub Actions, GitLab CI)
- `/topia monitoring` — Observability, logging, alerting setup
- `/topia server-setup` — VPS/cloud server provisioning
- `/topia ssl-domain` — SSL certificates and domain configuration

#### Mobile (`extensions/mobile/PACK.md`)
- `/topia react-native` — React Native / Expo architecture and performance
- `/topia flutter` — Flutter state management and widget patterns
- `/topia app-store-prep` — App Store / Play Store submission preparation
- `/topia native-bridge` — Native module bridges (Turbo Modules, MethodChannel)

#### Security (`extensions/security/PACK.md`)
- `/topia owasp-audit` — OWASP Top 10 vulnerability audit
- `/topia pentest-patterns` — Penetration testing methodology
- `/topia secret-mgmt` — Secret management and rotation
- `/topia compliance` — Compliance framework guidance (SOC2, HIPAA, PCI)

#### E-commerce (`extensions/ecommerce/PACK.md`)
- `/topia shopify-dev` — Shopify theme/app development (Hydrogen, Liquid)
- `/topia payment-integration` — Payment flow (Stripe Payment Intents, 3DS)
- `/topia cart-system` — Shopping cart architecture
- `/topia inventory-mgmt` — Stock tracking with optimistic locking

#### AI/ML (`extensions/ai-ml/PACK.md`)
- `/topia llm-integration` — LLM API clients with retry and structured output
- `/topia rag-patterns` — RAG pipeline (chunking, embedding, retrieval, reranking)
- `/topia embedding-search` — Hybrid search (BM25 + vector)
- `/topia fine-tuning-guide` — Fine-tuning dataset prep, training, evaluation

#### Content (`extensions/content/PACK.md`)
- `/topia blog-patterns` — Blog system (pagination, RSS, reading time)
- `/topia cms-integration` — Headless CMS setup (Sanity, Contentful, Strapi)
- `/topia mdx-authoring` — MDX pipeline with custom components
- `/topia i18n` — Internationalization (locale routing, translations)
- `/topia seo-patterns` — SEO audit (JSON-LD, sitemap, meta tags, OG)

#### Analytics (`extensions/analytics/PACK.md`)
- `/topia tracking-setup` — Analytics tracking with consent management
- `/topia ab-testing` — A/B experiment design and statistical significance
- `/topia funnel-analysis` — Conversion funnel tracking and drop-off analysis
- `/topia dashboard-patterns` — KPI dashboards with server-side aggregation

### Quick Actions
- `/topia status` — Show current project state from .topia/ files

## Usage

When the user runs `/topia <action>`, invoke the corresponding `Topia:<action>` skill.
For L4 pack commands, read the specified PACK.md file and follow the matching skill's workflow.
If no action is provided, show this help menu.
