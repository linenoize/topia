<!-- Adapted from forcedotcom/sf-skills skills/platform-permission-set-generate/SKILL.md @219a84a, Apache-2.0; modified -->
<!-- Adapted from forcedotcom/sf-skills skills/platform-metadata-discovery-get/references/scoped-soql.md @219a84a, Apache-2.0; modified -->

# Security reviewer

Permission and sensitive-field impact. Don't grant anything.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.

## Before you read

- Confirm the user record before reading their audit trail. `audit_query` needs that id and a time window. A display name isn't a confirmed user.
- Confirm each permission set in the named org. Never compare a set from another org.

## What to report

- Who gains or loses access, on which objects and fields, and which sharing or field-level rules apply.
- Two permission sets: a matrix of object, field, system, Apex, tab, and custom permissions.
- PII stays aggregated by default. Values need `sf_show_values`.

Reading access rows:

- A row whose parent is owned by a profile belongs to that profile, and its label is an id. Read the profile name instead.
- No row for a field or object means no access through that set. Access can still come from another set, a profile, or sharing.
- These rows prove configured access, not use. A set's name doesn't prove an integration is active.
- Delete - All isn't proof that delete must succeed. A trigger or validation rule can still block it.
- Naming a missing permission doesn't assign it.

## Least-privilege checklist

Apply this to any proposed permission set or permission change.

- [ ] Purpose and audience are written in the description.
- [ ] Every field and object is one the request actually names. Never add a field by analogy, such as adding `Shipping*` because `Billing*` was named.
- [ ] Each field exists, confirmed through `schema_describe`.
- [ ] No required fields in field permissions. The platform rejects them, and master-detail fields are required on the child.
- [ ] No formula field is marked editable.
- [ ] Edit is granted only where edit is needed, and it includes read.
- [ ] `allowDelete`, `viewAllRecords`, `modifyAllRecords`, and `viewAllFields` are off unless the request justifies each one.
- [ ] Tab names are exact: `__c` on custom object tabs, `standard-` on standard object tabs.
- [ ] No duplicate entries.

**Needs a named person's security review, whatever the request says:** `ViewAllData`, `ModifyAllData`, `ManageUsers`, and anything org-wide or administrative.

**Dependent permissions.** Some user permissions fail to deploy unless the permissions they depend on are also on. Name the dependency and stop. Don't add unrequested permissions to get past the error: that widens the change the person confirmed.

Permission sets over profiles is advice, not a rule. Integration users should have their own login with minimum access.

## Making the change

This skill doesn't create a grant. A change to a permission set is a metadata plan. See `release-engineer.md`. Its reversibility class is `access`: the assignment can be removed, but access already used can't be undone. See `references/reversibility.md`.

Plans support `update` and `delete` only, with no insert, so Topia can't create a permission set assignment. A person assigns it in Setup. Say so rather than looking for a route.

Retrieves of permission sets and profiles need their related components too, or a later comparison misleads.
