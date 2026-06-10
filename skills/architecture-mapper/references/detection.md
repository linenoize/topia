# Stack detection

Walk the table top-to-bottom against the target repo. The first row whose **Required markers** all match selects the stack. The **Dependency tells** refine the match where one family has multiple sub-variants — they don't gate the match, they shape which hints get filled in. Use Glob and Read on the relevant files; do not run any build tools.

## Precedence table

| Order | Stack profile                  | Required markers (presence of any)                                                                               | Dependency tells (refine sub-variant)                                                                                                   |
| ----- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `node-express-mongo.md`        | `package.json` at the repo root (or at any monorepo workspace root)                                              | In `package.json` deps/devDeps: `express`/`fastify`/`koa`/`hapi`/`restify` → backend variant. `vue`/`@vue/*` → Vue. `react`/`next`/`@remix-run/*` → React. `mongoose`/`mongodb` → Mongo. `pg`/`mysql2`/`sqlite3`/`sequelize`/`prisma` → relational (use RELATIONAL_NOTE instead). `bullmq`/`bull`/`agenda`/`bee-queue`/`node-cron`/`node-schedule` → background variant. |
| 2     | `python-web.md`                | `pyproject.toml`, `requirements.txt`, `Pipfile`, `setup.py`, or `manage.py` at the repo root                     | In the chosen manifest: `django` / presence of `manage.py` → Django. `flask` → Flask. `fastapi` / `uvicorn` → FastAPI. `celery`/`rq`/`apscheduler` → background variant. `sqlalchemy`/`django.db` / `*.sql` migrations → relational. `motor`/`pymongo` → Mongo (rare on this stack, note it). |
| 3     | `generic.md`                   | None of the above matched                                                                                        | —                                                                                                                                        |

## How to read the markers

- "At the repo root" means at the path the user pointed to. In a monorepo, if the user targeted the whole repo but each app has its own `package.json` or `pyproject.toml`, show the user the structure and ask which workspace is primary before scaffolding — don't pick one silently.
- For `package.json`, actually read it. Check `dependencies`, `devDependencies`, and `peerDependencies`. Do not infer from folder names alone — a folder called `server/` proves nothing.
- For Python, a bare `requirements.txt` with only one dep is a valid match; don't require a `pyproject.toml`.
- Lockfiles (`package-lock.json`, `yarn.lock`, `poetry.lock`, `Pipfile.lock`) confirm the manifest was used, but the manifest is the source of truth for dep names.

## Evidence to surface to the user

When you report detection, include 3-5 concrete evidence lines. Example for Node:

```
Detected: Node.js + Express + MongoDB + Vue
Evidence:
  - package.json: express@^4.18, mongoose@^7.0, vue@^3.4
  - src/server.js: app.listen(...) + app.use('/api', router)
  - models/User.js: mongoose.Schema({ ... })
  - client/main.js: createApp(App).use(router).mount('#app')
Profile: references/stacks/node-express-mongo.md
```

This lets the user sanity-check and catch a wrong match before install.

## Ambiguous and mixed cases

- **Both `package.json` and `pyproject.toml` at the root.** Common for a Python backend with a Node frontend toolchain, or a Node backend with Python ML scripts. Show both pieces of evidence and ask: "Primary backend is Node or Python?" Scaffold for the primary. The user can run the skill again later against a subdirectory to scaffold the other.
- **`package.json` but no backend framework dep** (e.g., a pure Vite/Vue SPA with no server). Still use `node-express-mongo.md`; the frontend hints will populate and the backend hints will be mostly empty. Tell the user: "No backend framework detected — backend-focused commands will have thin hunt lists."
- **Nothing matches.** Use `generic.md`. The commands still install and still work; they'll just give Claude less stack-specific guidance and therefore need more human review.

## Not supported in v1 (deliberately)

- Go, Rust, Java/Spring, .NET, Ruby/Rails, PHP/Laravel, Elixir/Phoenix — these fall through to `generic.md`. Add a stacks file for any of them later by defining all placeholder values and inserting a row at the correct precedence.
