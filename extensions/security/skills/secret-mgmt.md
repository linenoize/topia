---
name: "secret-mgmt"
pack: "@Topia/security"
description: "Secret management patterns — audit current secret handling, design vault or environment strategy, implement rotation policies, detect secrets in pre-commit hooks, and verify zero leaks in logs, errors, and source history."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# secret-mgmt

Secret management patterns — audit current secret handling, design vault or environment strategy, implement rotation policies, detect secrets in pre-commit hooks, and verify zero leaks in logs, errors, and source history.

#### Workflow

**Step 1 — Scan Current Secret Handling**
Use Grep to search for hardcoded credentials, API keys, connection strings, and JWT secrets across all source files and config files. Check git history with Bash (`git log -S 'password' --source --all`) to surface secrets ever committed. Catalog every secret by type and location. Check for base64-encoded secrets (`grep -r 'base64' | grep -i 'key\|secret\|pass'`).

**Step 2 — Design Vault or Env Strategy**
Based on project type (serverless, container, bare metal), prescribe a secret backend: AWS Secrets Manager, HashiCorp Vault, Doppler, or `.env` + CI/CD injection. Define which secrets are per-environment vs per-service. Write the access pattern (IAM role, token scope, least privilege).

**Step 3 — .env File Safety Audit**
Verify `.env` and `.env.*` files are in `.gitignore`. Check that a `.env.example` exists with placeholder values (not real secrets). Audit CI/CD environment variable lists — flag any variable that contains `SECRET`, `KEY`, `TOKEN`, or `PASSWORD` that is not masked. Verify `.env.example` is kept in sync with application startup validation schema.

**Step 4 — Secret Rotation Automation**
Document rotation schedule per secret type. For AWS: use Secrets Manager rotation Lambda triggered on schedule. For GitHub Actions: document secret rotation runbook (rotate in provider → update in repo Settings → verify deployment). Add startup validation that fails fast if any required env var is absent or malformed. Set up gitleaks or trufflehog as pre-commit hook to catch accidental commits before they hit remote.

**Step 5 — Verify No Leaks in Runtime**
Use Grep to confirm secrets never appear in log statements, error responses, or exception stack traces. Check error serialization — does the global error handler accidentally serialize `process.env` or full request headers into the response body?

#### Example

```typescript
// PATTERN: startup validation — fail fast on missing secrets
import { z } from 'zod'

const SecretsSchema = z.object({
  DATABASE_URL:    z.string().url(),
  JWT_SECRET:      z.string().min(32),
  STRIPE_SECRET:   z.string().startsWith('sk_'),
  OPENAI_API_KEY:  z.string().startsWith('sk-'),
})

export const secrets = SecretsSchema.parse(process.env) // throws at boot if absent/malformed

// NEVER log secrets — use masked representation
logger.info(`DB connected to ${new URL(secrets.DATABASE_URL).hostname}`)

// PRE-COMMIT: .gitleaks.toml — scan for secrets before commit
// [[rules]]
// id = "generic-api-key"
// description = "Generic API Key"
// regex = '''(?i)(api_key|apikey|secret)[^\w]*[=:]\s*['"]?[0-9a-zA-Z\-_]{16,}'''
// entropy = 3.5

// ROTATION LAMBDA: AWS Secrets Manager rotation handler skeleton
export async function handler(event: SecretsManagerRotationEvent) {
  const { SecretId, ClientRequestToken, Step } = event
  switch (Step) {
    case 'createSecret':  await createNewVersion(SecretId, ClientRequestToken); break
    case 'setSecret':     await updateDownstreamService(SecretId, ClientRequestToken); break
    case 'testSecret':    await validateNewSecret(SecretId, ClientRequestToken); break
    case 'finishSecret':  await finalizeRotation(SecretId, ClientRequestToken); break
  }
}
```
