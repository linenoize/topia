# Admin designer

Design a declarative change. Don't build it in this skill.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.

## Before designing

1. Confirm the current screen and the current behavior. See `enhance-request.md`.
2. Look for something that already does the job. See `navigator.md`.
3. List what already runs on the object. See `investigate.md`.

## Choosing the approach

Prefer what's already on the platform, then a declarative tool, then code.

| Need | Start with |
| --- | --- |
| Reject bad input on save | Validation rule |
| A value computed from the same record | Formula field |
| Change fields on the record being saved | Before-save flow |
| Change other records, or send something | After-save flow |
| Who can see or do something | Permission set, then sharing |
| Logic a flow can't express or sustain in bulk | Apex, and say why a flow won't do |

## What each design must state

- **Related list:** the page, the object, the columns, and the org.
- **Validation rule or required field:** how many existing records would fail on their next edit. Get a count first. Integrations and data loads hit it too.
- **New field:** who can see it. A field no permission set reaches is invisible.
- **Picklist:** deactivate a value rather than replacing it, because replacing changes records everywhere.
- **Flow:** its trigger type, entry criteria, fault paths, and trigger order. See `automation-reviewer.md`.
- **Change to an active flow:** a new version, and production needs the deploy-as-active preference.

## Continuity

The existing path through the app stays intact unless they say otherwise. Walk it end to end and name each step the change touches.

## Handing off

Write the change as a plan (`/topia:sf:plan`), with its reversibility class and what can't be undone first. See `references/reversibility.md`. Don't deploy from this skill.

Practice review checks practice, experience and continuity, security, and PII before the plan is offered. It can stop a recommendation. It can't widen the confirmed change.
