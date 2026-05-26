---
name: "defense-in-depth"
pack: "@Topia/security"
description: "Multi-layer validation strategy — add validation at EVERY layer data passes through, not just the entry point. Prevents single-point-of-failure in input handling."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# defense-in-depth

Multi-layer validation strategy. When a bug is caused by invalid data flowing through the system, the fix must add validation at EVERY layer — not just where the error appeared. Different code paths bypass single validation points. All four layers are necessary; during testing, each catches bugs the others miss.

#### When to Use

- After `debug` finds a root cause involving invalid data propagation
- When `owasp-audit` identifies input validation gaps across multiple boundaries
- During new feature implementation where data crosses 3+ layers (API → service → DB)
- When a fix at one layer didn't prevent the same class of bug from recurring at another layer

#### The 4-Layer Model

| Layer | Purpose | What to Validate | Example |
|-------|---------|------------------|---------|
| **L1: Entry Point** | Reject invalid input at system boundary | Schema, type, format, size | Zod schema at API route, CLI arg parser |
| **L2: Business Logic** | Ensure data makes sense for the operation | Semantic validity, permissions, state | "User owns this resource", "balance >= withdrawal" |
| **L3: Environment Guards** | Prevent dangerous operations in wrong context | Path containment, env checks, capability limits | Refuse `git init` outside tmpdir in tests, block prod writes in dev |
| **L4: Debug Instrumentation** | Capture context for forensics when layers 1-3 fail | Stack traces, data snapshots at boundaries | `console.error` with full context before dangerous operations |

#### Workflow

**Step 1 — Map Data Flow**
Trace the path of the problematic data from entry point to crash site. Identify every function boundary it crosses. Each boundary is a potential validation layer.

**Step 2 — Audit Existing Validation**
For each boundary, check: does validation exist? Is it sufficient? Common gaps:
- Entry point validates type but not semantic meaning (e.g., "is string" but not "is valid email")
- Business logic assumes entry point already validated (no redundancy)
- Environment guards absent entirely (test code can hit production paths)
- No instrumentation to diagnose future failures

**Step 3 — Add Missing Layers**
For each gap, add validation appropriate to that layer:

```typescript
// L1: Entry Point — schema validation
const CreateOrderSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().positive().max(100000),
  currency: z.enum(['USD', 'EUR', 'VND']),
})

// L2: Business Logic — semantic validation
async function createOrder(data: CreateOrderInput) {
  const user = await db.users.findById(data.userId)
  if (!user) throw new NotFoundError('User not found')
  if (user.balance < data.amount) throw new InsufficientFundsError()
  // proceed...
}

// L3: Environment Guard — context protection
function writeToPath(targetDir: string, filename: string) {
  const resolved = path.resolve(targetDir, filename)
  if (!resolved.startsWith(path.resolve(targetDir))) {
    throw new SecurityError('Path traversal attempt blocked')
  }
  if (process.env.NODE_ENV === 'test' && !resolved.startsWith('/tmp')) {
    throw new SecurityError('Test environment: writes restricted to /tmp')
  }
}

// L4: Debug Instrumentation — forensic context
function dangerousOperation(input: unknown) {
  console.error('[DEFENSE] dangerousOperation called with:', {
    input,
    stack: new Error().stack,
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  })
  // proceed with operation...
}
```

**Step 4 — Verify All Layers**
Write tests that bypass each individual layer and confirm the next layer catches it:
- Test L2 with valid-schema but semantically invalid data (passes L1, caught by L2)
- Test L3 with valid business data but wrong environment (passes L1+L2, caught by L3)
- If any single-layer bypass succeeds end-to-end → the defense is incomplete

#### Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Fixing only at crash site, not at data origin | CRITICAL | Backward trace: fix at source AND add guards at each intermediate layer |
| L1 validation gives false sense of security | HIGH | L1 validates format only — L2 must validate meaning and permissions |
| Environment guards missing in test context | HIGH | L3: add `NODE_ENV` checks to prevent test pollution and dangerous operations |
| No forensic trail when all layers are bypassed | MEDIUM | L4: always log context before irreversible operations |

#### Connection to Other Skills

- Called by `debug` (L2): after root cause found, recommend defense-in-depth fix via `topia:fix`
- Called by `owasp-audit` (L4): when audit finds validation only at entry point
- Complements `guardian` (L2): sentinel gates commits, defense-in-depth designs the validation architecture
- Informs `api-security` (L4): API hardening is L1 of this model; defense-in-depth extends to all layers
