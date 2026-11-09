import { isFailure } from './adapter.js';
import { to18 } from './identity.js';
import { dataFailure, isReady, okResult, preferWriter, ready, refuse } from './tools.js';
import { appendJournal } from './journal.js';
import { escapeSoqlString } from './soql.js';
/**
 * Contract section 8. Records have no way to rehearse a save, so nothing here is
 * named as if they did. This reads, and says in its own lists what it read and what
 * only a save would exercise.
 */
const CHECKED = ['ids', 'count', 'before-values', 'object-crud', 'field-updateable', 'record-access'];
const NOT_CHECKED = ['validation-rules', 'triggers', 'flows', 'duplicate-rules', 'assignment-rules', 'restriction-rules', 'sends'];
/** UserRecordAccess takes at most 200 ids in one query. */
export const ACCESS_CHUNK = 200;
/** A frozen-id read. jsforce sends a query as a GET, and the REST API refuses a URI over 16,384 bytes. 200 ids encode to about 5,300 of them, with room for a long field list. */
export const READ_CHUNK = 200;
const ACCESS_NOTE = "One user's access, read through UserRecordAccess. It ignores restriction rules, so a pass here doesn't clear them.";
const FLS_NOTE = "Whether describe's field flags reflect this user's field-level security is not confirmed, so a field shown as updateable can still be refused by the save.";
const NOT_A_SAVE = 'Nothing was saved and no automation ran. A save can still fail on anything in not_checked.';
const AUTOMATION_UNREAD = 'could not be read, so assume some exists';
const NOT_THE_WRITER = "These reads ran as the read-only user, and the change runs as the writer, whose access wasn't checked. Log the writer in first, and this preview asks about it.";
export function chunked(items, size) {
    const out = [];
    for (let at = 0; at < items.length; at += size)
        out.push(items.slice(at, at + size));
    return out;
}
/** A custom object, big object, external object, platform event, or metadata type: anything but a standard object. */
const CUSTOM_OBJECT = /__[A-Za-z]+$/;
/** Active triggers and record-triggered flows on one object. Null when either list can't be read, so it never reads as none. */
export async function readAutomation(adapter, username, object) {
    const name = escapeSoqlString(object);
    // ApexTrigger.TableEnumOrId holds a standard object's name and a custom object's Id. By name alone a custom object returns
    // no rows and no error, which would read as "no triggers". So it is asked by both, and an Id that can't be found reads as unread.
    let match = `TableEnumOrId = '${name}'`;
    if (CUSTOM_OBJECT.test(object)) {
        const entity = await adapter.query(username, `SELECT DurableId FROM EntityDefinition WHERE QualifiedApiName = '${name}'`);
        if (isFailure(entity) || entity.truncated || entity.records.length !== 1)
            return null;
        const durable = entity.records[0]?.DurableId;
        if (typeof durable !== 'string' || !/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(durable))
            return null;
        match = `TableEnumOrId IN ('${name}', '${durable.slice(0, 15)}', '${to18(durable.slice(0, 15))}')`;
    }
    const triggers = await adapter.query(username, `SELECT Name, Status FROM ApexTrigger WHERE ${match} AND Status = 'Active'`, { tooling: true });
    if (isFailure(triggers) || triggers.truncated)
        return null;
    const flows = await adapter.query(username, `SELECT ApiName, Label, TriggerType FROM FlowDefinitionView WHERE IsActive = true AND TriggerObjectOrEvent.QualifiedApiName = '${name}' AND TriggerType IN ('RecordBeforeSave', 'RecordAfterSave', 'RecordBeforeDelete')`);
    if (isFailure(flows) || flows.truncated)
        return null;
    return { triggers: triggers.records.map(row => String(row.Name)), flows: flows.records.map(row => String(row.ApiName)) };
}
async function readAccess(adapter, username, user, ids, operation) {
    const flag = operation === 'delete' ? 'HasDeleteAccess' : 'HasEditAccess';
    const parts = chunked(ids, ACCESS_CHUNK);
    const notEditable = [];
    let editable = 0;
    for (const part of parts) {
        const read = await adapter.query(username, `SELECT RecordId, HasEditAccess, HasDeleteAccess, MaxAccessLevel FROM UserRecordAccess WHERE UserId = '${escapeSoqlString(user.id)}' AND RecordId IN (${part.map(id => `'${id}'`).join(', ')})`);
        if (isFailure(read) || read.truncated)
            return null;
        const answered = new Map(read.records.map(row => [to18(String(row.RecordId)), row[flag] === true]));
        for (const id of part) {
            if (answered.get(id) === true)
                editable += 1;
            else
                notEditable.push(id);
        }
    }
    return { chunks: parts.length, editable, notEditable, note: ACCESS_NOTE };
}
export async function recordsPreview(adapter, args, ctx) {
    const tool = 'records_preview';
    const who = await preferWriter(adapter, ctx, args.orgId);
    const proven = await ready(adapter, ctx, tool, args.orgId, undefined, who.as);
    if (!isReady(proven))
        return proven;
    const { username, orgId } = proven.record;
    const operation = args.operation;
    const given = args.frozenRecordIds.map(to18);
    const ids = [...new Set(given)];
    const changes = args.changes;
    if (operation === 'delete' && changes.length > 0)
        return refuse(ctx, tool, orgId, username, 'A delete takes no changes.');
    if (operation === 'update' && changes.length === 0)
        return refuse(ctx, tool, orgId, username, 'An update names at least one field and its new value.');
    if (ids.length !== given.length)
        return refuse(ctx, tool, orgId, username, 'The frozen ids hold a duplicate, so the count would be wrong.');
    const described = await adapter.describe(username, args.object);
    if (isFailure(described))
        return dataFailure(ctx, tool, proven, described);
    const checked = [...CHECKED];
    const notChecked = [...NOT_CHECKED];
    const blockers = [];
    const unchecked = (name) => {
        checked.splice(checked.indexOf(name), 1);
        notChecked.push(name);
    };
    const objectCrud = { updateable: described.updateable === true, deletable: described.deletable === true };
    if (!who.judged)
        for (const name of ['object-crud', 'field-updateable'])
            unchecked(name);
    else if (operation === 'update' && !objectCrud.updateable)
        blockers.push(`Describe says ${described.name} can't be updated by this user.`);
    else if (operation === 'delete' && !objectCrud.deletable)
        blockers.push(`Describe says ${described.name} can't be deleted by this user.`);
    const fields = changes.map(change => {
        const field = described.fields.find(item => item.name.toLowerCase() === change.field.toLowerCase());
        if (field === undefined)
            blockers.push(`The object has no field ${change.field}.`);
        else if (who.judged && !field.updateable)
            blockers.push(`Describe says ${field.name} can't be updated.`);
        return { field: field?.name ?? change.field, exists: field !== undefined, updateable: field?.updateable === true };
    });
    // Read so a field this user can't see fails here. The values stop here too: a count of how many match would be an oracle.
    const readable = fields.filter(field => field.exists).map(field => field.field);
    const select = [...new Set(['Id', 'SystemModstamp', ...readable])].join(', ');
    const found = new Set();
    for (const part of chunked(ids, READ_CHUNK)) {
        const read = await adapter.query(username, `SELECT ${select} FROM ${described.name} WHERE Id IN (${part.map(id => `'${id}'`).join(', ')})`);
        if (isFailure(read))
            return dataFailure(ctx, tool, proven, read);
        if (read.truncated)
            return refuse(ctx, tool, orgId, username, 'The org returned only part of these records, so nothing here can be trusted.');
        for (const row of read.records)
            found.add(to18(String(row.Id)));
    }
    appendJournal(ctx.projectRoot, { event: 'query.executed', correlationId: ctx.correlationId, projectRoot: ctx.projectRoot, orgId, mode: ctx.mode, at: new Date(ctx.now).toISOString(), soql: `SELECT ${select} FROM ${described.name} WHERE Id IN (:ids)`, counts: { rows: found.size } });
    const missing = ids.filter(id => !found.has(id));
    if (missing.length > 0)
        blockers.push(`The org returned ${ids.length - missing.length} of ${ids.length} frozen ids.`);
    const user = await adapter.liveUser(username);
    const recordAccess = isFailure(user) || !who.judged ? null : await readAccess(adapter, username, user, ids, operation);
    if (recordAccess === null)
        unchecked('record-access');
    else if (recordAccess.notEditable.length > 0)
        blockers.push(`This user can't ${operation === 'delete' ? 'delete' : 'edit'} ${recordAccess.notEditable.length} of ${ids.length} records.`);
    const automation = await readAutomation(adapter, username, described.name);
    if (automation === null)
        notChecked.push('automation-list');
    return okResult(ctx, tool, proven, {
        object: described.name,
        operation,
        checked,
        not_checked: notChecked,
        automation: automation === null ? [AUTOMATION_UNREAD] : [...automation.triggers.map(name => `trigger ${name}`), ...automation.flows.map(name => `flow ${name}`)],
        count: ids.length,
        found: found.size,
        missing,
        objectCrud,
        fields,
        recordAccess,
        blockers,
        notes: [NOT_A_SAVE, FLS_NOTE, ...(who.judged ? [] : [NOT_THE_WRITER])],
        next: 'This changes nothing. Show these lists unedited, then write the plan with records_plan_update.',
    });
}
