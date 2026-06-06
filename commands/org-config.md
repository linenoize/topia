---
name: org-config
description: Interview-driven setup for .topia/org/org.md — team roles, policies, approval flows, and governance level. Run standalone or as part of /topia finalize.
---

# /topia org-config

Configures **team policy** for Topia. Output is [`.topia/org/org.md`](../.topia/org/org.md) — the file `guardian` and `readiness` read at compile time to enforce your org's rules on every commit and edit.

**Teams:** commit `.topia/org/` to git so every developer and agent session shares the same gates.

## When to run

| When | Why |
|------|-----|
| During `/topia finalize` | Step 2b — right after machine setup, before per-repo onboard |
| First time in a new repo | Replace template placeholders with real team data |
| Policy change | Re-run or edit `org.md` manually, then refresh hooks |

## Behavior

Invoke the **org-config** skill (`skills/org-config/SKILL.md`):

1. Read existing `.topia/org/org.md` (or seed from template).
2. Ask structured questions (team shape, governance, review rules, security, deploy).
3. Write updated `org.md` preserving all five required sections.
4. Write `.topia/org/.configured` and summarize what gates will enforce.

Flags (intent):

- `/topia org-config --force` — overwrite even if file looks customized
- `/topia org-config --dry-run` — show planned changes without writing

## After org-config

If dispatch hooks are installed, refresh compile so `<ORG-POLICY>` updates:

```bash
node "$TOPIA_ROOT/compiler/bin/topia.js" setup --global --preset gentle --yes
```

Reference: [`docs/ORG-CONFIG.md`](../docs/ORG-CONFIG.md)
