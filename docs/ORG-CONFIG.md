# Org Config — `.topia/org/org.md`

The single file where your team's policies, roles, approval flows, and governance level live. `guardian` and `readiness` read this **at compile time** and bake your rules into their runtime hooks — so the rules a developer hits at commit time match what the doc says.

It's the only file under `.topia/` that gets committed to git (the rest is per-session state). You can — and should — edit it for each project.

---

## When you'll touch it

| Trigger | What to update |
|---|---|
| **First Topia install** | Read the example file; replace placeholders (team names, lead handles, reviewers) with real values. |
| **New team joins the repo** | Add a row to the `## Teams` table. |
| **Security policy change** (CVE SLA, secret rotation cadence) | Update `## Policies > Security`. |
| **Deploy window changes** | Update `## Policies > Deployment`. |
| **New approval flow** (e.g., "data exports need legal review") | Add to `## Approval Flows`. |
| **Governance posture flips** (loose → moderate → strict) | Update `## Governance Level`. |

You do **not** need to touch this file for routine development. It's a policy file, not a per-feature workflow file.

---

## What each section drives

### `## Teams`
Used by `guardian` and `review` to attribute findings ("eng team owns this file"). Future: `team` orchestrator can route domain-tagged work to the right team's reviewers.

### `## Roles`
Defines who can override what. `completion-gate` and `guardian` consult this when an agent claims an override is authorised.

| Role | What it gates |
|---|---|
| `admin` | Can override any gate including `sentinel BLOCK` |
| `maintainer` | Can override `readiness` and `review`; cannot override `guardian` |
| `contributor` | Cannot override any blocking gate |
| `reviewer` | Read + comment only |

### `## Policies > Code Review`
- **Minimum reviewers** → `review` enforces a minimum on PRs
- **Self-merge allowed** → `git` blocks self-merges if `No`
- **Required reviewers for security-tagged files** → routed to `guardian`

### `## Policies > Security`
- **Dependency audit frequency** → `dependency-doctor` schedule
- **Secret rotation** → flagged by `guardian` when secrets are detected past rotation date
- **CVE response SLA** → `dependency-doctor` priority bucketing
- **OWASP scan on every PR** → `guardian` enforce/advise mode

### `## Policies > Deployment`
- **Staging required** → `deploy` blocks production without a staging deploy in the same session
- **Production deploy window** → `deploy` warns or blocks outside the window
- **Rollback authority** → who can run `/topia deploy --rollback`
- **Deploy freeze on incident** → `incident` blocks `deploy` while active

### `## Policies > Branching`
Read by `git` skill for semantic commit + branch-name validation.

### `## Approval Flows`
Each flow defines who → does what → who approves. `build`, `team`, and `review-intake` consult these to know when to pause for human approval vs proceed autonomously.

### `## Governance Level`
Master toggle. Three values:

| Level | sentinel | preflight | completion-gate | quarantine |
|---|---|---|---|---|
| **Loose** | advise | advise | advise | advise |
| **Moderate** *(default)* | **block** on HIGH/CRITICAL | **block** on critical | **block** on missing evidence | advise |
| **Strict** | **block** on any finding | **block** on any | **block** on missing evidence | **block** on tainted output |

You can also override per-gate inline (see the example file's bottom section).

---

## How it's parsed

`compiler/parser.js#parseOrgConfig` reads this file at **compile time** — when `topia hooks install` runs, or when `topia setup` regenerates the hook scripts. The parsed config becomes an `<ORG-POLICY>` block injected into `guardian` and `readiness`'s SKILL.md outputs.

**You must re-run `topia setup` after editing `org.md`** for changes to take effect at runtime. Otherwise the previously-compiled hooks keep enforcing the old rules.

```bash
# After editing .topia/org/org.md:
node compiler/bin/topia.js setup --global --preset gentle
node compiler/bin/topia.js doctor    # verifies the parse succeeded
```

---

## What happens if it's missing

If `.topia/org/org.md` doesn't exist:
- `guardian` and `readiness` fall back to their default rules (the conservative defaults you'd expect: block secrets, require tests, etc.)
- `topia doctor` does **not** complain — it's optional.
- You get no team attribution, no custom approval flows, no governance overrides.

Most projects benefit from filling it in. Bare-minimum useful fill: pick a governance level + name your team in the `## Teams` table.

---

## What happens if it's malformed

The parser is tolerant but logs warnings:

- Missing section (e.g., no `## Teams`) → that section is treated as empty
- Empty table → no rows applied, no error
- Unparseable governance level → falls back to **Moderate**
- Front-matter missing `name` → defaults to the directory name

Run `topia doctor` to see the parser's view of your file:

```bash
node compiler/bin/topia.js doctor
```

If parsing fails outright, `guardian` / `readiness` skip the `<ORG-POLICY>` injection and fall back to defaults. Your code keeps working; you just don't get the custom rules.

---

## Example walkthrough

Imagine your team wants:
- 2 reviewers minimum on every PR
- Secrets must rotate monthly (yours rotate quarterly)
- Production deploy only Mon-Thu 09:00-15:00

Edit the relevant sections:

```markdown
## Policies

### Code Review
- **Minimum reviewers**: 2
- **Self-merge allowed**: No

### Security
- **Secret rotation**: Monthly

### Deployment
- **Production deploy window**: Mon-Thu 09:00-15:00 local
```

Then:

```bash
node compiler/bin/topia.js setup --global --preset gentle
# In the next Claude session:
/topia review   # will flag PRs with <2 reviewers
/topia deploy   # will refuse production deploys outside the window
```

---

## Where to go next

- **Template + full field reference**: [`.topia/org/org.md`](../.topia/org/org.md) — the live file in this repo, pre-filled with realistic defaults
- **Hook architecture**: [`docs/HOOKS.md`](HOOKS.md)
- **Sentinel skill spec**: [`skills/guardian/SKILL.md`](../skills/guardian/SKILL.md)
- **Preflight skill spec**: [`skills/readiness/SKILL.md`](../skills/readiness/SKILL.md)
