# Stack profile: generic fallback

Use this profile when no specific stack matched (no `package.json`, no `pyproject.toml` / `requirements.txt` / `manage.py`). The installed workflow still works — Claude will use Grep/Read/Explore to find entry points organically — but the hunt lists are stack-neutral, so expect thinner guidance and more manual judgment calls during the audit.

Tell the user explicitly: **"No specific stack matched, installing with generic hints. Sections about backend routing, ORM access, and frontend tracing will be less specific than for a recognized stack."**

## Placeholder values

## {{STACK_NAME}}

```
Unknown / unrecognized stack
```

## {{STACK_SUMMARY}}

```
The stack for this repo was not matched against the recognized profiles (Node.js/Python). The reverse-engineering workflow is installed with stack-neutral hints. Rely on organic discovery via file structure, build configs, and any README content to identify the runtime, HTTP layer, data persistence, and async processing.
```

## {{ENTRY_POINT_HINTS}}

```
- Build/run configs: `Makefile`, `Dockerfile`, `docker-compose.yml`, `Procfile`, CI workflow files — these usually reveal the real entry command
- Language-specific manifests if present: `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `*.csproj` / `*.sln`, `Gemfile`, `composer.json`, `mix.exs`
- Conventional entry files by language: `main.go`, `src/main.rs`, `Program.cs`, `Main.java`, `config.ru`, `index.php`, `lib/application.ex`
- Anything under `bin/`, `cmd/`, or `scripts/` invoked by the build/run config
- Shell scripts at the repo root (`start.sh`, `run.sh`) often document the real entrypoint even when the README is stale
```

## {{ROUTE_LAYER_HINTS}}

```
- Grep for conventional route-registration verbs in any language: `Route`, `route`, `Handler`, `Controller`, `GET `, `POST `, `@RequestMapping`, `@app.route`, `mux.HandleFunc`, `router.add`
- Look for a directory named `routes/`, `controllers/`, `handlers/`, `api/`, or `endpoints/`
- Look for OpenAPI/Swagger specs (`openapi.yaml`, `swagger.json`) — these enumerate the HTTP surface even when the code is opaque
- Middleware/interceptor patterns vary by framework — grep for `middleware`, `interceptor`, `filter`, `guard`
```

## {{DATA_ACCESS_HINTS}}

```
- Grep for `SELECT `, `INSERT `, `UPDATE `, `DELETE ` in source files — any SQL reveals relational access
- Look for a directory named `models/`, `entities/`, `schemas/`, `repositories/`, `dao/`
- Migration directories: `migrations/`, `db/migrate/`, `flyway/`, `liquibase/`
- Config files mentioning connection strings: `.env`, `application.yml`, `appsettings.json`, `config.yml`
- Docker Compose services named `postgres`, `mysql`, `mongodb`, `redis` reveal the persistence layer even when code doesn't
```

## {{BACKGROUND_WORK_HINTS}}

```
- Check for a separate worker/daemon process in the build/run config (Procfile `worker:` line, Docker Compose service, systemd unit)
- Grep for "queue", "job", "scheduler", "cron", "worker", "consumer" across the repo
- Look for message-broker deps in manifests or Compose services (RabbitMQ, Kafka, Redis, SQS, NATS)
- Scheduled work outside the app: crontabs in Dockerfiles, cron YAMLs in k8s manifests, cloud scheduler configs
```

## {{INTEGRATION_HINTS}}

```
- Grep for HTTP client usage by common patterns: `http.`, `HttpClient`, `WebClient`, `.Get(`, `.Post(`, `fetch(`, `axios.`, `requests.`, `httpx.`
- Config/env for third-party URLs or API keys: `.env*`, `application.yml`, `appsettings.json` — the keys are the integrations
- Webhook handlers are usually routes that validate a signature header; grep for `X-*-Signature`, `hmac`, `verify_signature`
- SDK imports reveal integrations cleanly — inspect each dep in the manifest by name
```

## {{FRONTEND_HINTS}}

```
- Check for a `frontend/`, `client/`, `web/`, `ui/`, or `public/` subdirectory
- Look for template directories: `templates/`, `views/`, `resources/views/`
- A SPA coexisting with a backend will usually have its own `package.json` inside a subdirectory — note it but trace the backend primarily
- If only static HTML/CSS/JS with no build tooling, there's no "frontend framework" to trace; just treat the HTML files as the UI entry points
- If the app is headless (API-only, CLI, worker), skip frontend tracing entirely
```

## {{UI_SURFACE_HINTS}}

```
- If any of these are present, treat as the UI root and inventory from there:
  - `frontend/`, `client/`, `web/`, `ui/`, `public/` at the repo top level
  - `templates/`, `views/`, `resources/views/` for server-rendered templates
  - A subdirectory with its own `package.json` (SPA nested inside a polyglot repo)
- For each UI file, identify:
  - template-language forms (ASP.NET Razor `@Html.BeginForm`, Rails ERB `form_for`, Go templates `{{ .Action }}`, PHP `<form action>`)
  - button/link elements with an action URL or a JS handler
  - tables or lists — find the backend endpoint they read from
- If the repo is headless (pure API, CLI, or worker with no UI markup), write a single-line `ui-surface-map.md`: "No UI surface detected — this stack is headless" with the evidence that convinced you (no HTML, no template folder, no frontend deps). Then stop.
- If detection is ambiguous (some HTML files but no clear entry point), inventory what's visible and label confidence **speculative**. Manual follow-up is expected.
```

## {{HUNT_PRIORITY_LIST}}

```
1. Build/run configs: `Dockerfile`, `docker-compose.yml`, `Makefile`, `Procfile`, CI workflows
2. Language manifest (whichever exists): `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `*.csproj`, `Gemfile`, `composer.json`, `mix.exs`
3. Entry-point files by convention: `main.*`, `Program.cs`, `config.ru`, `index.php`, shell scripts at repo root
4. Route/controller/handler directories or the grep patterns listed in route hints
5. Data access: model/entity/repository directories, migration directories, any SQL strings
6. Background processing: worker/daemon declarations in Procfile/Compose/k8s, queue/scheduler grep
7. Integration SDK imports and third-party URL/key config
8. Frontend directory if present (`frontend/`, `client/`, `web/`, `templates/`)
9. Tests that document expected behavior — often the clearest signal in a legacy or obscure codebase
10. READMEs, ARCHITECTURE.md, CONTRIBUTING.md — verify against code, don't trust blindly
```

## {{MONGODB_NOTE}}

```
```

## {{RELATIONAL_NOTE}}

```
```

Both database notes are empty for the generic profile — the data-model command will prompt the user to identify the persistence layer during analysis.
