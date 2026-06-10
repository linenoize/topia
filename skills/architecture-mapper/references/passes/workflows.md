> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Document the main business and operational workflows in this detected stack (from stack profile) system.

Arguments: $ARGUMENTS

Tasks:
1. Read all docs in `docs/architecture/`.
2. Group workflows into:
   - user-facing workflows
   - admin / ops workflows
   - background workflows (scheduled or queue-triggered)
   - integration-triggered workflows (webhook or inbound message)
3. For each workflow document:
   - start condition
   - major decision points (where the flow branches)
   - state transitions (entity status changes)
   - data stores / collections / tables touched
   - integrations invoked
   - success and failure branches
4. Write `docs/architecture/workflows.md`.

Required output:
- workflow catalog (table grouped by category)
- detailed workflow sections
- one Mermaid `flowchart TD` per major workflow
- "where business rules live" subsection (which file/function enforces each rule)
- retry / failure behavior where visible

Avoid generic BPM language — tie every step to a concrete code artifact. If the code enforces a rule implicitly (e.g., via validation library + schema), cite both.

## Required linking

Follow the cross-linking conventions in `references/conventions.md`:
- Each workflow section starts with `### {Workflow name} {#workflow-{slug}}`.
- State transitions cite the file enforcing them and link to the entity: "Order transitions `pending → paid` in [payments module](./module-map.md#module-payments), updating [Order entity](./data-models.md#entity-order)".
- The `flowchart TD` per workflow uses slug IDs on nodes that map to real addressable things (modules, endpoints, jobs, entities) and emits `click` directives for them.
- Cross-link related steel threads: a workflow often composes multiple threads — link via `[User login thread](./steel-threads.md#thread-user-login)`.
- End the file with a `## Backlinks` section.
