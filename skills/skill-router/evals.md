# Eval Scenarios — `skill-router` skill

## Eval: E01 — false multi-match stack consolidation

### Prompt
User: "Review this PR and check code quality before we merge — look for issues and whether we're ready."

Discovery surfaces overlapping candidates whose descriptions all mention review / quality / check: `review`, `audit`, and `readiness` (and optionally `guardian`). Intent classification picks a primary via L1 > L2 > L3 and routing table.

### Expected Reasoning
Agent detects ≥2 stack candidates (description/intent overlap or alternates within ~30% of top score). Runs Step 2.5 Stack Consolidation: picks one primary (typically `review` or `audit` per routing table), loads HARD-GATE digests from `skill-index.json` for near-matches only, diffs unique gates, emits Stack Brief ≤300 tokens, announces `Stack consolidated: primary topia:X; folded Y, Z`, then Skill-invokes **only** the primary.

### Must Include
- Stack Brief with `Primary:`, `Folded (not loaded):`, and unique constraints (or empty list if no unique gates)
- Single Skill invoke of the primary skill
- Announcement that stack was consolidated

### Must NOT
- Fully Read or Skill-invoke near-match `SKILL.md` bodies in the same turn
- Treat near-matches as parallel `team` workstreams
- Skip Step 2.5 when ≥2 false multi-match candidates exist

### Category
happy-path

---

## Eval: E02 — compound intent deferred, not folded

### Prompt
User: "Add auth and deploy it to production."

### Expected Reasoning
Step 2 Compound Intent Resolution sequences `build` first, `deploy` second. Step 2.5 must **not** fold `deploy` HARD-GATEs into a build Stack Brief as if it were a false multi-match. `deploy` appears under `Deferred (legitimate later chain)` if a Stack Brief is emitted at all, or is left for `chain_metadata.suggested_next` after build completes.

### Must Include
- Primary route to `topia:build` (or equivalent L1 for implementation)
- `deploy` treated as deferred / sequential — not folded as a near-match body load

### Must NOT
- Skill-invoke both `build` and `deploy` in the same turn as parallel stacks
- Absorb deploy workflow constraints into build as if descriptions merely overlapped

### Category
edge-case

---

## Eval: E03 — single match skips consolidation

### Prompt
User: "What does the `parseSkill` function do in compiler/parser.js?"

### Expected Reasoning
Request is QUESTION/EXPLORE (LITE) or routes to a single skill (e.g. recon). Fewer than 2 stack candidates → Step 2.5 is skipped. No Stack Brief required.

### Must Include
- Routing classification completed (Step 0.25 / Step 1)
- At most one skill loaded for the answer path (or direct answer under LITE)

### Must NOT
- Emit a Stack Brief with empty folded list as noise
- Load multiple unrelated skill bodies

### Category
happy-path

---

## Eval: E04 — CODE_CHANGE uses artifact-first completion

### Prompt
User: "Add a null check to `parseSkill` so missing frontmatter returns null instead of throwing."

### Expected Reasoning
Classifies as `CODE_CHANGE`, routes to `topia:build` (or equivalent). Emits structured routing proof. Completes with skill-defined Cook Report if build owns the session; otherwise RESULT / FILES / EVIDENCE / EXCEPTIONS. No status-narrator prose.

### Must Include
- Routing proof or Routing Decision naming `topia:build` (or the routed skill)
- Final artifact sections: either Cook Report **or** RESULT + FILES + EVIDENCE + EXCEPTIONS

### Must NOT
- Use status-narrator templates: "What I verified…", "key takeaway…", "worth knowing…", "Let me know if…", "Great question"
- Replace Cook Report with RESULT/FILES when `topia:build` defined the final format

### Category
happy-path

---

## Eval: E05 — status-narrator prohibition on debug completion

### Prompt
User: "The reset token reuse test is failing — fix it."

### Expected Reasoning
Classifies as `DEBUG_REQUEST` (FULL). Routes through debug → fix/build as appropriate. Final user text is an execution record (evidence + files + exceptions), not a discovery diary.

### Must Include
- Structured route announce (proof line or Routing Decision)
- Observable evidence (command/test outcome) rather than "I verified…"

### Must NOT
- Narrate investigation ("After investigating…", "I found…", "To make sure…")
- Add praise, task restatement, or follow-up invitations

### Category
edge-case

---

## Eval: E06 — routing announce allowed without investigation narration

### Prompt
User: "Refactor the session serializer to drop unused fields."

### Expected Reasoning
Routes with one structured announce, then implements. Allowlisted protocol (routing proof / Routing Decision / Stack Brief if applicable) is present; surrounding chat does not expand into status narration.

### Must Include
- `> Routed: …` or `## Routing Decision` with skill + type
- Artifact-first final (Cook Report or Default Response Contract)

### Must NOT
- Expand the announce into multi-paragraph process storytelling
- Mix "transparency" coaching language with the routing block

### Category
happy-path
