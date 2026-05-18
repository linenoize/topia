---
name: "supply-chain"
pack: "@Topia/security"
description: "Supply chain security analysis — detect dependency confusion attacks, typosquatting, lockfile injection, manifest confusion, and verify SLSA provenance attestations. Generates a complete supply chain risk report."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# supply-chain

Supply chain security analysis — detect dependency confusion attacks, typosquatting, lockfile injection, manifest confusion, and verify SLSA provenance attestations. Generates a complete supply chain risk report.

#### Workflow

**Step 1 — Inventory Dependencies**
Use Read on `package.json` / `requirements.txt` / `go.mod` / `Cargo.toml`. Build a complete dependency graph including devDependencies and indirect (transitive) dependencies via `npm ls --all --json` or `pip-audit --format json`. Flag phantom dependencies — packages used in source code (via import) but not declared in the manifest.

**Step 2 — Check Naming Collisions (Dependency Confusion)**
For any private/internal package names (scoped like `@company/internal-lib` OR unscoped names that look internal), verify they also exist on the public registry (npm, PyPI, RubyGems). If a package name is registered internally but NOT on the public registry, an attacker can register it there — package managers may prefer the public version depending on configuration. Flag all such packages for private registry enforcement.

**Step 3 — Typosquatting Detection**
Compare each dependency name against a known-popular packages list. Flag names with edit distance ≤ 2 from a popular package: `lodas` (lodash), `requets` (requests), `coloers` (colors), `expres` (express). Also flag: packages with unusual character substitution (zero vs letter o, l vs 1), recently published packages with very high download counts but no GitHub stars, and packages with install scripts that execute shell commands.

**Step 4 — Verify Lockfile Integrity**
Check that `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` exists and is committed. Verify resolved hashes match between manifest and lockfile. Detect lockfile injection: compare resolved URLs — any `file:`, `git+`, or non-registry URL in the lockfile for a package expected to come from the registry is a red flag. Run `npm audit signatures` (npm ≥ 9.5) to verify package signatures against the registry's public key.

**Step 5 — Audit Transitive Dependencies and Known Malicious Packages**
Run `npm audit --all` / `pip-audit` / `cargo audit`. Cross-reference against OSV (Open Source Vulnerabilities) database. Check install scripts: `cat node_modules/<pkg>/package.json | jq '.scripts.install,.scripts.postinstall'` — any install script running `curl | sh` or spawning child processes is HIGH severity.

**Step 6 — SLSA Provenance and Report**
For critical dependencies, check if SLSA provenance attestations are available (`npm install @sigstore/bundle` / cosign verify-attestation). Emit `.topia/security/supply-chain-report.md` with: dependency inventory, collision risks, typosquatting flags, lockfile anomalies, install script warnings, and remediation steps.

#### Example

```bash
# STEP 1: Full dependency inventory with phantom dep check
npm ls --all --json 2>/dev/null | jq '[.. | objects | select(.version) | {name: .name, version: .version}]' > deps-inventory.json

# STEP 2: Check if internal package exists on public registry
# VULNERABLE: @company/utils exists internally but NOT on npm → dependency confusion risk
curl -s https://registry.npmjs.org/@company/utils | jq '.error'
# If returns null (package exists publicly) → verify it's YOUR package, not an attacker's

# STEP 3: Detect install scripts in dependencies
for pkg in node_modules/*/package.json; do
  scripts=$(jq -r '(.scripts.install // "") + " " + (.scripts.postinstall // "")' "$pkg")
  if echo "$scripts" | grep -qE 'curl|wget|exec|spawn|child_process'; then
    echo "WARN: install script in $pkg: $scripts"
  fi
done

# STEP 4: Verify lockfile integrity (npm ≥ 9.5)
npm audit signatures
# Expected: "audited X packages, 0 packages have invalid signatures"
```

```typescript
// PATTERN: enforce private registry for scoped packages (.npmrc)
// @company:registry=https://npm.company.internal
// //npm.company.internal/:_authToken=${NPM_INTERNAL_TOKEN}

// PATTERN: detect phantom dependencies in TypeScript
// Any import from a package not in dependencies/devDependencies = phantom dep
// Tool: depcheck → npx depcheck --json | jq '.missing'
```
