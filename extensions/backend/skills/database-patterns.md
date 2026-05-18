---
name: "database-patterns"
pack: "@Topia/backend"
description: "Database design and query patterns — schema design, migrations, indexing strategies, N+1 prevention, soft deletes, read replicas, connection pooling, seeding."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# database-patterns

Database design and query patterns — schema design, migrations, indexing strategies, N+1 prevention, soft deletes, read replicas, connection pooling, seeding.

#### Workflow

**Step 1 — Detect ORM and query patterns**
Use Grep to find ORM usage (`prisma.`, `knex(`, `sequelize.`, `typeorm`, `drizzle`, `mongoose.`, `db.query`) and raw SQL strings. Read schema files (`schema.prisma`, `migrations/`, `models/`) to understand the data model.

**Step 2 — Detect N+1 and missing indexes**
Scan for loops containing database calls (a query inside `for`, `map`, `forEach` → N+1). Check foreign key columns for missing indexes. Identify queries with `WHERE` clauses on unindexed columns. Flag each with the specific query and fix.

**Step 3 — Emit optimized queries**
For N+1: emit eager loading (`include`, `populate`, `JOIN`). For missing indexes: emit migration files. For unsafe raw SQL: emit parameterized version. For connection pooling: check pool config and recommend sizing based on max connections.

**Step 4 — Soft delete and query scoping**
Emit soft delete pattern: add `deleted_at TIMESTAMPTZ` column, update all `findMany`/`findUnique` calls to include `WHERE deleted_at IS NULL`. Cascade consideration: soft-delete parent should soft-delete children (emit trigger or application-level cascade). For Prisma: emit a custom extension that injects the filter automatically. Warn about index bloat from soft-deleted rows — add partial index `WHERE deleted_at IS NULL` to keep index lean.

**Step 5 — Read replicas, connection pooling, and seeding**
Read replicas: emit query routing — writes to primary, reads to replica. Handle replication lag: do not read from replica immediately after write in the same request (use primary for the read-after-write). For Prisma: emit `$extends` with read/write client split. Connection pooling deep dive: PgBouncer in transaction mode for serverless (each query gets a connection); Prisma's built-in pool for long-running servers. Pool sizing formula: `connections = (core_count * 2) + effective_spindle_count`. Seeding: emit factory functions using `@faker-js/faker` — deterministic seeds via `faker.seed(42)` for reproducible test data.

#### Example

```typescript
// BEFORE: N+1 — one query per post to get author
const posts = await prisma.post.findMany();
for (const post of posts) {
  post.author = await prisma.user.findUnique({ where: { id: post.authorId } });
}

// AFTER: eager loading, single query with JOIN
const posts = await prisma.post.findMany({
  include: { author: { select: { id: true, name: true, avatar: true } } },
});

// Migration: missing indexes + soft delete column
-- Migration: add_indexes_and_soft_delete_to_posts
ALTER TABLE posts ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX idx_posts_author_id ON posts(author_id);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_active ON posts(author_id, created_at DESC) WHERE deleted_at IS NULL;

// Prisma soft delete extension (auto-scopes all queries)
const softDelete = Prisma.defineExtension({
  name: 'softDelete',
  query: {
    $allModels: {
      async findMany({ model, operation, args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
      async delete({ model, args, query }) {
        return (query as any)({ ...args, data: { deletedAt: new Date() } } as any);
      },
    },
  },
});
const prisma = new PrismaClient().$extends(softDelete);

// Read replica routing with Prisma
const primaryClient = new PrismaClient({ datasources: { db: { url: PRIMARY_URL } } });
const replicaClient = new PrismaClient({ datasources: { db: { url: REPLICA_URL } } });
const db = { write: primaryClient, read: replicaClient };
// Usage: db.write.user.create(...) vs db.read.user.findMany(...)

// Factory seeding
import { faker } from '@faker-js/faker';
faker.seed(42); // reproducible

const createUserFactory = (overrides = {}) => ({
  id: faker.string.uuid(),
  email: faker.internet.email(),
  name: faker.person.fullName(),
  createdAt: faker.date.past(),
  ...overrides,
});

await prisma.user.createMany({ data: Array.from({ length: 50 }, () => createUserFactory()) });
```
