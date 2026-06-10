# Stack profile: Node.js + Express-style + Mongo/Relational + Vue/React

Use this profile when the target repo has a `package.json`. Adjust the sub-variants based on dependency tells (see `references/detection.md`):

- **Backend framework**: Express is the baseline; Fastify/Koa/Hapi/Restify use nearly identical tracing patterns. NestJS is different enough that the hints should mention "controllers/providers/modules" and decorators.
- **Database**: if `mongoose`/`mongodb` → populate `{{MONGODB_NOTE}}`, leave `{{RELATIONAL_NOTE}}` empty. If `pg`/`mysql2`/`sqlite3`/`prisma`/`sequelize` → populate `{{RELATIONAL_NOTE}}`, leave `{{MONGODB_NOTE}}` empty. If both or neither, note the uncertainty.
- **Frontend**: Vue → Vue-specific `{{FRONTEND_HINTS}}`. React/Next → React-specific. Pure SPA with no backend → backend sections will be thin; that's fine.

## Placeholder values

## {{STACK_NAME}}

```
Node.js + Express-style API + MongoDB + Vue/React frontend
```

(Adjust to match actual detected deps — e.g., "Node.js + Fastify + PostgreSQL + React".)

## {{STACK_SUMMARY}}

```
An npm-managed JavaScript/TypeScript full-stack application. Backend is an Express-style HTTP server with mounted routers and middleware chains; data persistence goes through an ORM/ODM or native driver; frontend is a Vue or React SPA bundled by Vite/Webpack/Next. Background work, when present, typically uses bullmq, agenda, node-cron, or worker processes.
```

## {{ENTRY_POINT_HINTS}}

```
- Backend startup: `server.js`, `app.js`, `index.js`, `src/server.js`, `src/app.js`, `bin/www`
- Backend wiring: the file that calls `app.listen(...)` — follow its imports back to find all `app.use(...)` and `router.use(...)` chains
- Frontend startup (Vue): `main.js`/`main.ts`, `App.vue`, `router/index.js`, Pinia/Vuex store files
- Frontend startup (React): `index.js`/`index.tsx`, `App.jsx`/`App.tsx`, `Routes.jsx`, Redux/Zustand/Jotai store files
- Next.js: `pages/**` or `app/**`, `middleware.ts`, `next.config.js`
- npm scripts: `package.json` → `scripts` — `dev`/`start`/`build`/`test` tell you the runtime entry
- Worker/CLI entry: anything in `bin/`, `scripts/`, `workers/`, or invoked via `node <file>` in package scripts
```

## {{ROUTE_LAYER_HINTS}}

```
- `app.use(path, router)` — routers mounted at a base path
- `router.get/post/put/patch/delete(path, ...handlers)` — specific endpoints
- Middleware chains: auth, validation (express-validator/joi/zod), error handlers (4-arg `(err, req, res, next)`)
- NestJS: `@Controller('path')` + `@Get`/`@Post` decorators, modules import providers
- Fastify: `fastify.register(plugin)` + `fastify.route(...)`
- Next.js API: files under `pages/api/**` or `app/api/**/route.ts` — one file per endpoint
- tRPC: `router.procedure(...)` — not REST; trace via procedure name instead of URL
```

## {{DATA_ACCESS_HINTS}}

```
- Mongoose: `mongoose.Schema(...)`, `mongoose.model(...)`, `.find/.findOne/.aggregate/.populate`
- Native MongoDB driver: `db.collection('x').find(...)`, aggregation pipelines as arrays
- Prisma: `prisma.<model>.findMany/create/update` + `schema.prisma`
- Sequelize: `Model.findAll/findOne/create/update`, `sequelize.define` or class-based models
- TypeORM: `@Entity()` classes, `repository.find(...)`
- Knex: query-builder chains `knex('table').select().where(...)`
- Raw SQL: look for `.query(...)` calls with SQL string literals — these are the ones without an ORM abstraction
- Indexes/constraints: schema files or migration files (`migrations/**`, `knex/migrations/**`, `prisma/migrations/**`)
```

## {{BACKGROUND_WORK_HINTS}}

```
- bullmq/bull: `new Queue(...)`, `new Worker(...)`, job processors
- Agenda: `agenda.define(...)`, `agenda.every(...)`
- node-cron / node-schedule: `cron.schedule(pattern, fn)`
- Standalone worker processes: separate npm script (`worker`, `jobs`) that boots without `app.listen`
- Event-driven: `EventEmitter` instances or library-specific emitters (e.g., Mongoose change streams)
- Abused timers: `setInterval`/`setTimeout` used as schedulers — usually fragile, flag as a risk
- Dead-letter/retry: inspect queue config for `attempts`, `backoff`, `removeOnFail`
```

## {{INTEGRATION_HINTS}}

```
- HTTP clients: `axios`, `node-fetch`/native `fetch`, `got`, `undici` — grep for `.post(`/`.get(` against URL literals
- Email: `nodemailer`, SendGrid/Postmark/Resend SDKs
- Payments: Stripe SDK (`stripe.*.create`), PayPal SDK
- Storage: `@aws-sdk/client-s3`, `@google-cloud/storage`, Azure Blob SDK, local `fs` with upload dirs
- Auth providers: `passport`, Auth0/Clerk/NextAuth SDKs, JWT libs (`jsonwebtoken`)
- Webhooks (inbound): routes that verify an `X-*-Signature` header — trace into the handler to see what they trigger
- Feature flags: LaunchDarkly/ConfigCat/Unleash SDKs or custom env-based flags
- Secrets/config: `dotenv` loading a `.env`, `config/` directory, `process.env.*` references
```

## {{FRONTEND_HINTS}}

```
- Vue: views/pages under `src/views/**` or `src/pages/**`, components under `src/components/**`, router config in `src/router/`, composables in `src/composables/`, stores in `src/stores/` (Pinia) or `src/store/` (Vuex). Button handlers and form `@submit` are the steel-thread entry points on the frontend side.
- React: routes in `src/routes/` or file-based (`pages/**`, `app/**`), hooks in `src/hooks/`, store in `src/store/` (Redux) or feature-sliced. Event handlers (`onClick`, `onSubmit`) start the traces.
- API client layer: a single `src/api/` or `src/services/` folder wrapping axios/fetch is the typical indirection between UI and backend. If there isn't one, UI components call the backend directly — note that as an architecture smell.
- Environment-based API URLs: `import.meta.env.VITE_API_URL` (Vite) or `process.env.REACT_APP_*` (CRA) or `process.env.NEXT_PUBLIC_*` (Next).
- State-fetching patterns: `onMounted`/`useEffect` with an API call, or TanStack Query / SWR hooks.
```

## {{UI_SURFACE_HINTS}}

```
- Vue: every `.vue` file under `src/views/**` or `src/pages/**` is a candidate page. Within each, template `<button>`/`<form>`/`<v-btn>`/`<el-button>`/`<a-button>` with `@click`/`@submit` are widgets. The handler is the method in `<script setup>` or the options-API `methods` block. Follow the handler to the API-client call (axios/fetch/composable) to get the endpoint.
- React: pages under `src/pages/**`, `src/routes/**`, or `app/**` (Next). Widgets are JSX elements with `onClick`/`onSubmit`/`onChange`. Handlers are inline arrow functions or named functions — trace to `useQuery`/`useMutation`/`axios.post(...)` calls to find the endpoint.
- Tables and lists: look for `<v-data-table>`, `<el-table>`, `<a-table>`, DataGrid (MUI), AG-Grid, TanStack Table. Each column's `render`/`cell` may trigger actions — capture row-level buttons separately.
- Forms: Vue `v-model` + `@submit.prevent`, React controlled inputs + `onSubmit`, Formik/react-hook-form/VeeValidate patterns. The submit handler is the trace start.
- Modals/drawers: look for `v-dialog`, `el-dialog`, headlessui `Dialog`, MUI `Dialog`, Radix/Shadcn `Dialog`. Opening a modal is a widget; the actions inside are their own widgets.
- Navigation widgets (nav links, breadcrumbs) usually trigger router navigation only, no API call — note briefly but don't catalog exhaustively.
- API client layer: if `src/api/` or `src/services/` exists, each file there typically names endpoints after the UI widget that calls them — a huge shortcut. If the widget imports from this layer, follow the import to find the endpoint URL.
- State-driven widgets: TanStack Query `useQuery(['key'], fetcher)` and SWR `useSWR(key, fetcher)` — the fetcher identifies the endpoint.
- If the frontend is a separate repository (common with monorepos/microservices), note it and scope this doc to whatever frontend code is in the current repo. If there is none, write a short no-UI stub.
```

## {{HUNT_PRIORITY_LIST}}

```
1. `package.json` scripts
2. Backend startup: `server.js`, `app.js`, `index.js`, `src/server.js`, `src/app.js`
3. Frontend startup: `main.js`/`main.ts`, `App.vue`/`App.tsx`, `router/index.js`, store files
4. Express/Fastify registration: `app.use`, `router.use`, `router.<verb>`, middleware mounting
5. Data access: ORM schemas/models (Mongoose/Prisma/Sequelize/TypeORM) and any raw `.query()` calls
6. Business logic layers: `services/`, `use-cases/`, `domain/`, `controllers/`
7. Background processing: bullmq/agenda/node-cron configuration and worker entry points
8. Integrations: axios/fetch clients, email/storage/payment SDKs, webhook route handlers
9. Config/env: `.env*`, `config/` directory, `process.env.*` references
10. Tests that reveal expected behavior: `__tests__/`, `*.test.js`, `*.spec.js`, `cypress/`, `e2e/`
```

## {{MONGODB_NOTE}}

```
This is MongoDB. Do not assume relational behavior. Relationships are typically code-managed (via `.populate()`, manual joins, or aggregation `$lookup`), not database-enforced. There are no SQL stored procedures; business logic lives in the Node layer. Pay attention to:

- embedded vs referenced documents (embedding hides a relationship)
- aggregate pipelines (often where the real business logic hides)
- indexes declared in schema files or via `Model.createIndexes()`
- transactions via session objects (`startSession`) — if absent, assume no cross-document atomicity
```

## {{RELATIONAL_NOTE}}

```
```

(Empty for the Mongo sub-variant. When the stack is relational, swap this fence with the body below and blank out `{{MONGODB_NOTE}}`.)

Relational body to use instead when relational deps are detected:

```
This is a relational database. Look for:

- migration files under `migrations/`, `prisma/migrations/`, `db/migrate/` — the schema history
- FK constraints and indexes declared in migrations (not always mirrored in ORM models)
- stored procedures, views, and triggers (grep migrations for `CREATE PROCEDURE`, `CREATE VIEW`, `CREATE TRIGGER`)
- N+1 patterns where an ORM loops over a collection and fires one query per item
- transactions via `sequelize.transaction`/`prisma.$transaction`/explicit `BEGIN`
```
