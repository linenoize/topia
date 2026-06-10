# Stack profile: Python web (Django / Flask / FastAPI)

Use this profile when the target repo has `pyproject.toml`, `requirements.txt`, `Pipfile`, `setup.py`, or `manage.py`. Sub-variants are detected from dependency tells:

- **Django**: `manage.py` present and/or `django` in deps. Strong conventions (apps, models, views, urls, admin).
- **Flask**: `flask` in deps. Weak conventions — blueprints vary wildly by project.
- **FastAPI**: `fastapi` + `uvicorn` in deps. Routers + Pydantic models + dependency injection.
- **Mixed** (Django + DRF, or Flask + FastAPI side-by-side) — common; note both and pick the primary HTTP entry.

Use `{{RELATIONAL_NOTE}}` by default (most Python web apps use Postgres/MySQL/SQLite). Use `{{MONGODB_NOTE}}` only if `motor` or `pymongo` is in deps.

## Placeholder values

## {{STACK_NAME}}

```
Python web app (Django / Flask / FastAPI)
```

(Replace with the actual detected framework, e.g., "Python + Django + Celery + PostgreSQL".)

## {{STACK_SUMMARY}}

```
A Python web application managed via pip/poetry/pipenv. HTTP surface is Django (conventional MVC-ish with apps/views/urls), Flask (blueprints + route decorators), or FastAPI (routers + Pydantic). Persistence usually goes through Django ORM or SQLAlchemy against a relational DB. Background work typically uses Celery, RQ, or APScheduler. Frontend may be server-rendered templates, a separate SPA, or Django REST Framework responses consumed by an external client.
```

## {{ENTRY_POINT_HINTS}}

```
- Django: `manage.py`, `<project>/settings.py`, `<project>/urls.py`, `<project>/wsgi.py` / `asgi.py`, each app's `urls.py` + `views.py` + `models.py` + `admin.py` + `apps.py`
- Flask: `app.py`, `wsgi.py`, `run.py`, `create_app()` factory pattern in `__init__.py`, blueprint files under `blueprints/` or `apps/`
- FastAPI: `main.py`, `app.py`, `api/__init__.py`, router files defining `APIRouter()` instances, `uvicorn.run(...)` call sites
- Celery: `celery.py` or `celery_app.py`, `tasks.py` files in each app
- CLI entry: `manage.py <command>`, Click/Typer apps, files referenced by `[project.scripts]` in `pyproject.toml`
- Gunicorn/uvicorn: check `Procfile`, `Dockerfile` CMD, or systemd unit files for the actual prod entry
```

## {{ROUTE_LAYER_HINTS}}

```
- Django: `urlpatterns = [path(...), ...]` in `urls.py`. DRF routers via `DefaultRouter().register(...)`. Class-based views (CBVs) vs function-based views (FBVs). Middleware chain in `settings.MIDDLEWARE`.
- Flask: `@app.route("/path")` or `@blueprint.route(...)`. `app.register_blueprint(bp, url_prefix=...)`. `before_request`/`after_request` hooks.
- FastAPI: `@router.get("/path")`, `@router.post(...)`. `Depends(...)` for DI-based auth/validation/session. Pydantic models on request/response. `app.include_router(router, prefix=...)`.
- Common: decorators for auth (`@login_required`, custom `@require_role`), permission classes in DRF (`permission_classes = [...]`), dependency-injected auth in FastAPI.
```

## {{DATA_ACCESS_HINTS}}

```
- Django ORM: `Model.objects.filter/get/create/update`, managers (`objects = CustomManager()`), querysets, `select_related`/`prefetch_related` for joins
- SQLAlchemy (classic or Flask-SQLAlchemy or SQLModel): declarative models, `session.query(Model).filter(...)`, 2.0-style `select(...)`, Alembic migrations
- Peewee / Tortoise: smaller ORMs — similar model-based APIs
- Raw SQL: `cursor.execute("SELECT ...")` inside `connection.cursor()` blocks — these are the ones without ORM abstraction
- Migrations: `<app>/migrations/*.py` (Django), `alembic/versions/*.py` (SQLAlchemy+Alembic)
- Indexes/constraints: inside migration files and `Meta.indexes` on Django models
- Mongo variant: `motor.motor_asyncio.AsyncIOMotorClient` or `pymongo.MongoClient`, `db.collection.find(...)`
```

## {{BACKGROUND_WORK_HINTS}}

```
- Celery: `@app.task` or `@shared_task` decorators, `celery -A <app> worker`, `celery -A <app> beat` for schedules, `CELERY_BEAT_SCHEDULE` in settings or `celery.py`
- RQ (Redis Queue): `@job(...)` decorators, `Queue(...)` + `.enqueue(...)` call sites, `rq worker` process
- APScheduler: `BackgroundScheduler()` or `AsyncIOScheduler()`, `.add_job(...)` with cron/interval/date triggers
- django-q, Dramatiq, Huey: similar task-decorator + worker patterns
- Standalone scripts: `scripts/` directory run via cron on the host (not inside the app process) — check Dockerfile/crontab
- asyncio tasks: `asyncio.create_task(...)` or `BackgroundTasks` dependency in FastAPI
```

## {{INTEGRATION_HINTS}}

```
- HTTP clients: `requests`, `httpx` (sync and async), `aiohttp`
- Email: Django `send_mail`, Flask-Mail, SendGrid/Mailgun/Postmark SDKs, raw `smtplib`
- Payments: `stripe` Python SDK, PayPal REST SDK
- Storage: `boto3` (S3), `google-cloud-storage`, Azure `azure-storage-blob`, Django storages
- Auth: `django.contrib.auth`, Flask-Login, FastAPI `OAuth2PasswordBearer`, `python-jose`/`PyJWT` for tokens, `authlib` for OAuth providers
- Webhooks (inbound): routes that validate a signature header (`X-*-Signature`) — trace to handler
- Secrets: `django-environ`, `python-dotenv`, `dynaconf`, `pydantic-settings`
- Observability: `sentry-sdk`, `opentelemetry-*`, Datadog `ddtrace`
```

## {{FRONTEND_HINTS}}

```
- Django templates (server-rendered): `templates/**/*.html`, `{% url %}` reverse lookups tie templates to view names — trace from a template form/button to the view that handles it
- Django admin: `admin.py` auto-generates CRUD UI for registered models; major "admin workflows" often live here
- Jinja2 (Flask/FastAPI): `templates/` directory, `render_template(...)` calls
- Static SPA coexisting with API: check for a `frontend/` or `client/` subdirectory with its own `package.json` — if present, treat that as a separate frontend concern and use the Node profile hints for that subtree mentally (but don't install there)
- If no frontend template or SPA: API is consumed by external clients. Entry-trace should focus on API consumers, mobile apps, or partner integrations described in READMEs and integration docs.
```

## {{UI_SURFACE_HINTS}}

```
- Django server-rendered UI lives in `templates/**/*.html`. Each template is effectively a page. Widgets:
  - `<form action="{% url 'view_name' %}" method="post">` — action maps directly to a view via URL reversal. The view is the handler.
  - `<button type="submit">` inside a form submits that form. Buttons outside forms typically use `{% url %}` links.
  - Django admin (`admin.py` registrations) auto-generates CRUD widgets; catalog these under "admin UI" rather than enumerating every generated button.
- Flask/Jinja2 templates under `templates/` work the same way — `url_for('view_name')` in forms/links ties the widget to a Flask view function.
- FastAPI: by default it has no UI. If a template directory exists (Jinja2Templates), treat like Flask. If the API is consumed by a separate SPA repo, note "UI is external" and stop.
- DRF + HTML Browsable API: the auto-generated forms at each endpoint count as admin/debug UI, not user-facing — do not catalog them.
- Tables/lists: Django list views with `ListView` or DRF ViewSet list actions render tabular UI via templates or via a JS client. For JS clients (DataTables, HTMX tables), grep templates for `hx-get`/`hx-post` attributes — those are HTMX-driven widgets.
- HTMX patterns are common in modern Django/FastAPI: `hx-get="/path"`, `hx-post="/path"`, `hx-target="#id"`. Each attribute IS the widget→endpoint binding.
- If the frontend is a separate repository (Vue/React SPA consuming the Python API), record "UI in separate repo: <name/path>" and scope this doc to whatever UI lives in the current repo (admin templates, DRF browsable, HTMX partials). If nothing, write a short no-UI stub.
```

## {{HUNT_PRIORITY_LIST}}

```
1. Package manifests: `pyproject.toml`, `requirements*.txt`, `Pipfile`, `setup.py`, `setup.cfg`
2. Django: `manage.py`, `<project>/settings.py`, `<project>/urls.py`, `<project>/wsgi.py` / `asgi.py`
3. Flask: `app.py`, factory `create_app()`, `wsgi.py`, blueprint registration
4. FastAPI: `main.py`, top-level `FastAPI()` instance, `include_router` calls
5. Per-app structure (Django): `<app>/views.py`, `<app>/models.py`, `<app>/urls.py`, `<app>/tasks.py`, `<app>/admin.py`
6. Middleware: `settings.MIDDLEWARE` (Django), `before_request` (Flask), `app.add_middleware(...)` (FastAPI)
7. Background: `celery.py`, `@shared_task` definitions, `CELERY_BEAT_SCHEDULE`, RQ/APScheduler configs
8. Migrations: `<app>/migrations/` (Django) and `alembic/versions/` (SQLAlchemy)
9. Integrations: HTTP client call sites, email/storage/payment SDK imports, webhook handlers
10. Config/env: `.env`, `settings.py` variants, `pydantic-settings` classes, `Dockerfile`/`Procfile`
```

## {{MONGODB_NOTE}}

```
```

(Empty by default for Python web. If `motor` or `pymongo` is detected, populate with the Mongo note from `references/stacks/node-express-mongo.md` and blank out `{{RELATIONAL_NOTE}}`.)

## {{RELATIONAL_NOTE}}

```
This is a relational database (Postgres/MySQL/SQLite likely). The schema history lives in migration files — read them. Look for:

- migration files under `<app>/migrations/*.py` (Django) or `alembic/versions/*.py` (SQLAlchemy)
- FK constraints, `unique_together`/`UniqueConstraint`, indexes declared in migrations or `Meta`
- stored procedures, views, and triggers (grep migrations for `RunSQL` + `CREATE PROCEDURE/VIEW/TRIGGER`)
- N+1 patterns: Django needs explicit `select_related`/`prefetch_related`; absence on a related-object loop is usually the bug
- transactions: `@transaction.atomic` / `with transaction.atomic():` (Django), `session.begin()` (SQLAlchemy), autocommit assumptions elsewhere
```
