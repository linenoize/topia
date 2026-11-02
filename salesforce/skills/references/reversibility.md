# Reversibility

Every plan has a class. The service computes it and supplies the fixed text. Your recovery text appears only under "The assistant's notes", and it can't change the class.

## Classes

| Class | Applies to | What the person is told |
| --- | --- | --- |
| `restorable` | Record update | Old values are saved. Restoring is a new plan, automation fires again, and records changed since are listed, not overwritten |
| `recycle-bin` | Record soft delete | Usually 15 days, but it can purge after 2 hours. No CLI undelete, so a person restores from Setup. Topia checks with `--all-rows` before offering guidance |
| `forward-only` | Metadata deploy | No undo. Restoring means deploying the pre-deploy snapshot as a new change |
| `access` | Permission grant | The assignment can be removed. Access already used can't be undone |
| `irreversible` | Sends, callouts, hard delete, merges | Hard delete and merge are not offered at all. Sends and callouts can't be recalled |

A plan can hold more than one effect. Name the worst class first.

## How to present it

1. **What can't be undone comes first**, above the benefit and above the steps.
2. Then the class name and the service's fixed text, unedited.
3. Then what restore means for this plan, if anything can be restored.
4. Your own recovery ideas last, under "The assistant's notes".

Never write "can be rolled back" without saying how, and by whom. A git revert isn't an org rollback.

## What a metadata redeploy can't restore

Show the items that apply before approval. They aren't fine print.

| Change | Why a redeploy doesn't undo it |
| --- | --- |
| Deleted custom field | Its data and history don't come back with the XML. A person may be able to restore the field from Setup for a limited time. Whether redeploying creates a new empty field is unconfirmed, so plan as if it does |
| Field type change | Values can be lost in the conversion. Redeploying the old type restores the definition, not the values |
| Picklist value replaced or removed | Replacing changes records everywhere, including in the Recycle Bin. Redeploying restores the value list, not what records held. Prefer deactivating a value |
| Activated flow version | A deploy creates a new version. Runs already done stay done, and what they changed or sent stays |
| Profile or permission set | A snapshot holds only what its manifest retrieved. A partial snapshot can't revert what it didn't capture. Permission set assignments are data, not metadata |
| Sends, callouts, published events | Already left the org. Nothing brings them back |

## What a record restore can't do

- It fires triggers and flows again. Anything they send is sent again.
- It adds history entries and moves `LastModifiedDate`.
- It skips records whose current value no longer equals the written value. Those are listed as conflicts.
- A deleted record's lookups come back only if they haven't been replaced. Children reparented by a merge stay reparented.

## Restore is a new plan

Restore is never part of the original approval.

- Records: a new plan with its own approval, run through `sf_restore_plan_execute`. It targets only ids whose current value still equals what was written.
- Soft deletes: guidance for a person in Setup. Topia has no undelete tool. It checks that the record is still in the bin first.
- Metadata: the rollback snapshot is deployed as a new change, with its own validation and approval. It also voids other validations.
- Permission grants: a new plan removing the assignment.

Never re-send automatically after a failure. Each resume is a new approval over what's left.
