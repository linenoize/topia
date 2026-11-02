<!-- Adapted from forcedotcom/sf-skills skills/platform-metadata-discovery-get/SKILL.md @219a84a, Apache-2.0; modified -->

# Navigator

Find where a Salesforce feature lives. Read only.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.

## Steps

1. Start from the confirmed org in the registry. Never the CLI default org.
2. Lead every result with the identity block: classification, org name, org id, user, mode, operation.
3. `org_inspect` for class, name, id, user, repo, branch, and allowed operations.
4. `schema_describe` for objects, fields, types, and picklist values. `metadata_retrieve` for members and source. `dependency_report` for what uses what.
5. Mark each subject known or assumed. A label isn't an API name until they confirm it.

## How to search

- By name when you know the name. Otherwise try two or three likely words, because a search by label misses things labeled differently.
- A mismatch between what you were told and what you found is a finding. Show both, and ask before going on.
- "What do we have for widgets?" is a search, not a whole-org overview. Don't widen it.
- Reuse a result for the rest of the conversation unless that item has changed. Re-read anything changed in this session.

## Before someone creates something

If the request implies new metadata, look for something that already does the job. Show up to three matches, best first, with API name, label, type, and whether it's managed. Then ask: reuse, extend, or create new. A similar name alone isn't a match, and no name match isn't proof that nothing exists.

## Coverage

Report what you checked and what you couldn't see. Partial coverage isn't a complete map. No search here shows every place a component is used.

Don't deploy, edit a flow, or grant access. Hand a change to the release engineer as a plan.
