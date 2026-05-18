---
name: "api-patterns"
pack: "@Topia/backend"
description: "RESTful and GraphQL API design patterns — resource naming, pagination, filtering, error responses, versioning, rate limiting, OpenAPI generation."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# api-patterns

RESTful and GraphQL API design patterns — resource naming, pagination, filtering, error responses, versioning, rate limiting, OpenAPI generation.

#### Workflow

**Step 1 — Detect API surface**
Use Grep to find route definitions (`app.get`, `app.post`, `router.`, `@Get()`, `@Post()`, `@Query`, `@Mutation`). Read each route file to inventory: endpoint paths, HTTP methods, response shapes, error handling approach.

**Step 2 — Audit naming and structure**
Check each endpoint against REST conventions: plural nouns for collections (`/users` not `/getUsers`), nested resources for relationships (`/users/:id/posts`), query params for filtering (`?status=active`), consistent error envelope. Flag violations with specific fix for each.

**Step 3 — Add missing pagination and filtering**
For list endpoints returning unbounded arrays, emit cursor-based or offset pagination. For endpoints with no filtering, add query param parsing with Zod/Joi validation. Emit the middleware or decorator that enforces the pattern.

**Step 4 — API versioning strategy**
Choose versioning approach based on project context: URL path (`/v2/users`) for public APIs with long deprecation windows; `Accept-Version: 2` header for internal APIs needing cleaner URLs; query param (`?version=2`) for simple cases. Emit version routing middleware and a deprecation warning header (`Deprecation: true, Sunset: <date>`) on v1 routes. Document migration path in the route file as a comment.

**Step 5 — OpenAPI/Swagger and GraphQL patterns**
For REST: emit OpenAPI 3.1 schema from route definitions using tsoa decorators (TypeScript), Fastify's built-in JSON Schema (`schema: { body, querystring, response }`), or NestJS `@ApiProperty`. For GraphQL: if schema-first, validate resolvers match schema types; if code-first (NestJS), check `@ObjectType` / `@Field` decorators. Add DataLoader to any resolver with a per-request DB call to prevent N+1 at the GraphQL layer. Emit subscription pattern (WebSocket transport) for real-time fields.

#### Example

```typescript
// BEFORE: inconsistent naming, no pagination, bare error
app.get('/getUsers', async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json(users);
});

// AFTER: REST naming, cursor pagination, error envelope, Zod validation
const paginationSchema = z.object({
  query: z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['active', 'inactive']).optional(),
  }),
});

app.get('/users', validate(paginationSchema), async (req, res) => {
  const { cursor, limit, status } = req.query;
  const users = await userRepo.findMany({ cursor, limit: limit + 1, status });
  const hasNext = users.length > limit;
  res.json({
    data: users.slice(0, limit),
    pagination: { next_cursor: hasNext ? users[limit - 1].id : null, has_more: hasNext },
  });
});

// Rate limiting: sliding window with Redis (atomic, no race condition)
const rateLimitMiddleware = async (req, res, next) => {
  const key = `rl:${req.ip}:${Math.floor(Date.now() / 60_000)}`; // 1-minute window
  const multi = redis.multi();
  multi.incr(key);
  multi.expire(key, 60);
  const [count] = await multi.exec();
  if (count > 100) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
  res.setHeader('X-RateLimit-Remaining', 100 - count);
  next();
};

// Fastify: built-in schema validation + OpenAPI generation
fastify.get('/users/:id', {
  schema: {
    params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
    response: { 200: UserSchema, 404: ErrorSchema },
  },
}, async (req, reply) => { /* handler */ });

// GraphQL: DataLoader prevents N+1 in resolvers
const userLoader = new DataLoader(async (userIds: string[]) => {
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  return userIds.map(id => users.find(u => u.id === id) ?? new Error(`User ${id} not found`));
});
// In resolver: return userLoader.load(post.authorId) — batches all loads per request
```
