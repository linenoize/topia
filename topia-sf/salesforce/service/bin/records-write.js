import { lockState } from './activation.js';
import { isFailure } from './adapter.js';
import { acceptAudit, auditBeforeWrite, auditFacts, auditRefusal } from './audit.js';
import { plainText, RECORD_WRITE_CEILING } from './contract.js';
import { compareLive, sameId } from './identity.js';
import { appendJournal } from './journal.js';
import { acquireRun, readLedger, writeLedger } from './ledger.js';
import { sweepProjectLogs } from './log-retention.js';
import { modeAllowsTool, toolRefusal } from './modes.js';
import { loadPlan } from './plan-tools.js';
import { canonical, overDestructiveCeiling, planExpired, planHashOf, sha256 } from './plans.js';
import { readPreImage, retainUntil, savePreImage } from './preimage.js';
import { readAutomation } from './preview.js';
import { classifyRecord, countOf, intendedFor, readRows, reconcileData, reconcileRecords, RUNNING_JOB_STATES } from './records-state.js';
import { effectiveLimits } from './registry.js';
import { COLLECTIONS_MAX_RECORDS } from './sf-cli.js';
import { formatToolText, okResult, withWriterReminder, writeCheck } from './tools.js';
const TOOL = 'sf_records_execute';
const POLL_BUDGET_MS = 4 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
/** What $.process.run reads of stdout. A plan over this can't reach the dialog in one piece, so it's refused rather than cut. */
const MAX_PINNED_CHARS = 3 * 1024 * 1024;
/** Encrypted and compound fields can't be read back or written back one for one. */
const NOT_CAPTURED = new Set(['encryptedstring', 'base64', 'address', 'location']);
const MAX_CAPTURED = 60;
function contextFor(input, mode) {
    return { ...input, mode, stamp: null, brief: null };
}
function journalRefusal(ctx, orgId, note) {
    try {
        appendJournal(ctx.projectRoot, { event: 'refusal', correlationId: ctx.correlationId, projectRoot: ctx.projectRoot, orgId, mode: ctx.mode, at: new Date(ctx.now).toISOString(), note });
    }
    catch {
        // A refusal stands whether or not the journal could take it.
    }
}
function stop(ctx, orgId, reason) {
    journalRefusal(ctx, orgId, reason);
    return { ok: false, reason };
}
function reasonOf(result) {
    const message = result.data?.message;
    return result.notice ?? (typeof message === 'string' ? message : 'That could not be checked, so nothing was written.');
}
function lockProblem(ctx) {
    const lock = lockState(ctx.storeRoot, ctx.projectRoot);
    if (lock.state === 'off')
        return 'Salesforce is not on for this project. /topia:sf:enable turns it on.';
    return lock.state === 'unreadable' ? lock.message : null;
}
function modeProblem(mode, tool) {
    return modeAllowsTool(mode, tool) ? null : `${tool} does not run in ${mode} mode. ${toolRefusal(tool, null) ?? ''}`.trim();
}
function briefProblem(plan, confirmedBriefHash) {
    if (confirmedBriefHash === null || plan.briefHash !== confirmedBriefHash)
        return `This plan needs a brief a person has confirmed this session. Call sf_brief_confirm with briefId ${plan.briefId} first. A chat reply is not confirmation.`;
    return null;
}
/** What a file could claim. The enum and the count are checked here, from the ids, whatever a hash says. */
function planProblem(plan) {
    if (plan.kind !== 'records')
        return 'That plan is not a record plan.';
    if (plan.operation !== 'update' && plan.operation !== 'delete')
        return 'A plan writes by update or delete, and nothing else.';
    if (!Array.isArray(plan.frozenRecordIds) || plan.frozenRecordIds.length === 0)
        return 'That plan has no frozen ids.';
    if (plan.count !== plan.frozenRecordIds.length)
        return 'That plan claims a count that is not the number of its ids.';
    if (new Set(plan.frozenRecordIds).size !== plan.frozenRecordIds.length)
        return 'That plan holds a duplicate id.';
    if (plan.frozenRecordIds.length > RECORD_WRITE_CEILING)
        return `A plan writes at most ${RECORD_WRITE_CEILING} records.`;
    return null;
}
function valuesProblem(plan, values) {
    const before = new Set((values.before ?? []).map(item => item.id));
    if (plan.frozenRecordIds.some(id => !before.has(id)))
        return 'That plan does not hold the before-state of every record, so it can not be judged per record.';
    if (plan.operation === 'update') {
        for (const id of plan.frozenRecordIds)
            if (Object.keys(intendedFor(values, id)).length === 0)
                return 'That plan names no new value for one of its records.';
    }
    return null;
}
function limitsProblem(proven, plan) {
    const limits = effectiveLimits(proven.entry);
    if (!limits.allowedOperationClasses.includes('write'))
        return "This org's limits in orgs.json don't allow a write.";
    if (overDestructiveCeiling({ operation: plan.operation, count: plan.frozenRecordIds.length }, limits.destructiveCeiling))
        return `Deleting ${plan.frozenRecordIds.length} records is over this org's ceiling of ${limits.destructiveCeiling}.`;
    return null;
}
export function transportFor(operation, count, retryingRefused = false) {
    // Collections goes all or none. A record the org refused last time could roll the whole batch back again, and Bulk judges rows one at a time.
    if (retryingRefused)
        return 'bulk';
    // The closed list holds one REST write, a PATCH, so a delete goes through Bulk at any size.
    return operation === 'update' && count <= COLLECTIONS_MAX_RECORDS ? 'collections' : 'bulk';
}
export function resultOf(ctx, tool, proven, given, wrote) {
    const data = withWriterReminder(proven.record, given);
    const result = okResult(ctx, tool, proven, data);
    return { ok: true, action: 'report', text: formatToolText({ ...result, sideEffect: wrote }), data, wrote };
}
function withConflicts(values, data) {
    if (values.restoreOf === undefined)
        return data;
    return { ...data, restoreOf: values.restoreOf, conflicts: (values.restoreConflicts ?? []).slice(0, 50), conflictCount: values.restoreConflicts?.length ?? 0, alreadyOld: values.restoreAlreadyOld ?? 0 };
}
function screenPlanFor(plan, values, ids, planHash) {
    const changes = values.perRecord !== undefined ? plan.changedFields.map(field => ({ field, value: "each record's saved value" })) : (values.changes ?? []);
    return { kind: 'records', object: plan.object, operation: plan.operation, changes, frozenRecordIds: ids, planHash, expiresAt: plan.expiresAt, businessObjective: values.businessObjective, notes: values.notes };
}
function samplesFor(plan, values, ids, rows) {
    return ids.slice(0, 3).map(id => {
        const row = rows.get(id) ?? {};
        const intended = intendedFor(values, id);
        if (plan.operation === 'delete')
            return { id, before: { SystemModstamp: row.SystemModstamp }, after: { Deleted: 'to the Recycle Bin' } };
        return { id, before: Object.fromEntries(plan.changedFields.map(field => [field, row[field] ?? null])), after: Object.fromEntries(plan.changedFields.map(field => [field, intended[field] ?? null])) };
    });
}
function classifyAll(plan, values, rows) {
    const before = new Map((values.before ?? []).map(item => [item.id, item]));
    return Object.fromEntries(plan.frozenRecordIds.map(id => [id, classifyRecord(plan, values, before.get(id), rows.get(id))]));
}
/** Whether a resume sends a record the org already refused in the same batch as records it did not. */
function retriesRefused(entry, ids) {
    // Alone, a refused record costs no one else a rollback. Beside others it could.
    return entry !== null && ids.some(id => entry.errors[id] !== undefined) && ids.some(id => entry.errors[id] === undefined);
}
/** The dialog step. A plan in any state but fresh or partial gets a report, and no dialog. */
export async function prepareRecordsWrite(adapter, input, request, confirmedBriefHash, mode, options = {}) {
    const ctx = contextFor(input, mode);
    const tool = options.tool ?? TOOL;
    try {
        const off = lockProblem(ctx);
        if (off !== null)
            return { ok: false, reason: off };
        const wrongMode = modeProblem(mode, tool);
        if (wrongMode !== null)
            return stop(ctx, '', wrongMode);
        const loaded = loadPlan(ctx.storeRoot, ctx.projectRoot, request.planId, ctx.now, { allowExpired: true });
        if (!loaded.ok)
            return stop(ctx, '', loaded.reason);
        const plan = loaded.plan;
        const shape = planProblem(plan);
        if (shape !== null)
            return stop(ctx, plan.orgId, shape);
        const unconfirmed = briefProblem(plan, confirmedBriefHash);
        if (unconfirmed !== null)
            return stop(ctx, plan.orgId, unconfirmed);
        sweepProjectLogs(ctx.storeRoot, ctx.projectRoot, ctx.now);
        const live = await writeCheck(adapter, ctx, tool, plan.orgId);
        if ('ok' in live)
            return { ok: false, reason: reasonOf(live) };
        const proven = live.ready;
        const { username } = proven.record;
        const limited = limitsProblem(proven, plan);
        if (limited !== null)
            return stop(ctx, plan.orgId, limited);
        const values = loaded.values;
        const incomplete = valuesProblem(plan, values);
        if (incomplete !== null)
            return stop(ctx, plan.orgId, incomplete);
        const ledger = readLedger(ctx.storeRoot, ctx.projectRoot, plan.id);
        const report = (rec) => resultOf(ctx, tool, proven, withConflicts(values, reconcileData(plan, rec)), false);
        if (ledger.state === 'done' && ledger.entry.kind === 'records') {
            return report({ status: 'done', counts: countOf(ledger.entry.records, plan.frozenRecordIds.length), records: ledger.entry.records, errors: ledger.entry.errors, sideEffects: ledger.entry.sideEffects, note: 'This plan already ran to the end. Nothing was sent.', wrongOrg: ledger.entry.wrongOrg ?? null, attempt: ledger.entry.attempts.at(-1) ?? null, transport: ledger.entry.attempts.at(-1)?.transport ?? null, jobId: ledger.entry.attempts.at(-1)?.jobId ?? null, jobState: null });
        }
        if (ledger.state === 'started' || ledger.state === 'unknown' || ledger.state === 'unreadable') {
            return report(await settled(adapter, ctx, username, plan, values, loaded.planHash, ledger));
        }
        // Missing, or partial. The ledger can be deleted, so the org gets the same question either way.
        const rec = await settled(adapter, ctx, username, plan, values, loaded.planHash, ledger);
        if (rec.status !== 'missing' && rec.status !== 'partial')
            return report(rec);
        if (ledger.state === 'missing' && rec.status === 'partial')
            return report(rec);
        if (planExpired(plan, ctx.now))
            return stop(ctx, plan.orgId, `That plan expired at ${plan.expiresAt}. Write a new plan.`);
        const audit = await auditBeforeWrite(adapter, ctx, plan.orgId, proven.record, plan.id);
        const auditStop = auditRefusal(audit, proven.record, 'nothing was written');
        if (auditStop !== null)
            return stop(ctx, plan.orgId, auditStop);
        const rows = await readRows(adapter, username, plan.object, plan.frozenRecordIds, plan.changedFields);
        if (isFailure(rows))
            return stop(ctx, plan.orgId, `The frozen records could not be read, so nothing was written. ${plainText(rows.message, 200)}`);
        const records = classifyAll(plan, values, rows);
        const counts = countOf(records, plan.frozenRecordIds.length);
        const held = ledger.state === 'partial' && ledger.entry.kind === 'records' ? ledger.entry : null;
        const ids = plan.frozenRecordIds.filter(id => records[id] === 'untouched' && held?.records[id] !== 'done');
        if (held === null && counts.untouched !== counts.total) {
            return stop(ctx, plan.orgId, `${counts.total - counts.untouched} of ${counts.total} frozen records changed since the plan, so nothing was written. Write a new plan, which reads them again.`);
        }
        if (ids.length === 0)
            return report(rec);
        const pinned = { planBytes: JSON.stringify({ plan, values, planHash: loaded.planHash }), expected: { attempts: held?.attempts.length ?? 0, ids } };
        if (pinned.planBytes.length > MAX_PINNED_CHARS)
            return stop(ctx, plan.orgId, 'This plan is too large to pass through the dialog in one piece, so nothing was written. Split it into smaller plans.');
        const automation = await readAutomation(adapter, username, plan.object);
        const facts = {
            identity: live.facts,
            samples: samplesFor(plan, values, ids, rows),
            differsFromPlan: counts.total - counts.untouched,
            automation: automation ?? undefined,
            transport: transportFor(plan.operation, ids.length, retriesRefused(held, ids)),
            ...auditFacts(audit),
            ...(held !== null ? { resume: { done: counts.done, changed: counts.changed + counts.missing, total: counts.total } } : {}),
            ...(options.restore !== undefined ? { restore: options.restore } : {}),
        };
        return { ok: true, action: 'approve', screenPlan: screenPlanFor(plan, values, ids, loaded.planHash), facts, pinned };
    }
    catch (error) {
        return stop(ctx, '', error instanceof Error ? `The plan could not be prepared, so nothing was written. ${error.message}` : 'The plan could not be prepared, so nothing was written.');
    }
}
/** Reconcile under the plan's lock, so it can't write the ledger across a run that's still going. */
async function settled(adapter, ctx, username, plan, values, planHash, ledger) {
    const held = acquireRun(ctx.storeRoot, ctx.projectRoot, plan.id);
    if (held === null) {
        const counts = ledger.state === 'missing' || ledger.state === 'unreadable' || ledger.entry.kind !== 'records' ? null : countOf(ledger.entry.records, plan.frozenRecordIds.length);
        return { status: 'started', counts, records: {}, errors: {}, sideEffects: null, note: 'Another run for this plan is going on this machine. Nothing was sent by this call.', wrongOrg: null, attempt: null, transport: null, jobId: null, jobState: null };
    }
    try {
        return await reconcileRecords(adapter, { projectRoot: ctx.projectRoot, storeRoot: ctx.storeRoot, now: ctx.now, mode: ctx.mode, correlationId: plan.id }, username, plan, values, planHash, ledger);
    }
    finally {
        held.release();
    }
}
function openPinned(planBytes) {
    let parsed;
    try {
        parsed = JSON.parse(planBytes);
    }
    catch {
        return { problem: 'The pinned plan could not be read, so nothing was written.' };
    }
    const { plan, values, planHash } = parsed;
    if (plan === undefined || values === undefined || typeof planHash !== 'string')
        return { problem: 'The pinned plan could not be read, so nothing was written.' };
    if (planHashOf(plan) !== planHash)
        return { problem: 'The pinned plan does not match its own hash, so nothing was written.' };
    if (sha256(canonical(values)) !== plan.valuesHash)
        return { problem: 'The pinned values do not match the plan hash, so nothing was written.' };
    return { plan, values, planHash };
}
function csvCell(value) {
    // Bulk API 2.0 ignores an empty cell on update. #N/A is how a field is cleared, and an empty string clears a text field.
    if (value === null || value === undefined || value === '')
        return '#N/A';
    const text = String(value);
    if (text === '#N/A')
        throw new Error('The value #N/A means an empty field in a bulk file, so it can not be written as text.');
    return `"${text.replaceAll('"', '""')}"`;
}
function bulkFile(plan, values, ids) {
    if (plan.operation === 'delete')
        return `Id\n${ids.join('\n')}\n`;
    const fields = plan.changedFields;
    const lines = ids.map(id => {
        const intended = intendedFor(values, id);
        return [id, ...fields.map(field => csvCell(intended[field]))].join(',');
    });
    return `${['Id', ...fields].join(',')}\n${lines.join('\n')}\n`;
}
function collectionsBody(plan, values, ids) {
    return JSON.stringify({ allOrNone: true, records: ids.map(id => ({ attributes: { type: plan.object }, id, ...intendedFor(values, id) })) });
}
function capturedFields(described, plan) {
    const others = described.fields.filter(field => field.updateable && !NOT_CAPTURED.has(field.type) && !plan.changedFields.includes(field.name)).map(field => field.name).sort();
    return [...plan.changedFields, ...others.slice(0, MAX_CAPTURED)];
}
/** A resume keeps what the first attempt saved: those are the true old values. */
function mergedImage(ctx, plan, planHash, transport, fields, ids, rows) {
    const read = readPreImage(ctx.storeRoot, ctx.projectRoot, plan.id, ctx.now);
    if (read.state === 'unreadable')
        throw new Error(read.detail);
    const held = read.state === 'ok' ? read.image.records : [];
    const known = new Set(held.map(item => item.id));
    const added = ids.filter(id => !known.has(id)).map(id => {
        const row = rows.get(id) ?? {};
        return { id, systemModstamp: String(row.SystemModstamp), values: Object.fromEntries(fields.map(field => [field, row[field] ?? null])) };
    });
    return { version: 1, planId: plan.id, planHash, orgId: plan.orgId, object: plan.object, operation: plan.operation, transport, capturedAt: new Date(ctx.now).toISOString(), retainUntil: retainUntil(ctx.now), fields, records: [...held, ...added] };
}
function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
/** Polls within a budget, because $.process.run stops at ten minutes. A job still going comes back as a status, and a later call picks it up. */
async function pollJob(adapter, username, jobId, options) {
    const deadline = Date.now() + (options.pollBudgetMs ?? POLL_BUDGET_MS);
    for (;;) {
        const job = await adapter.bulkJob(username, jobId);
        if (isFailure(job) || !RUNNING_JOB_STATES.includes(job.state) || Date.now() >= deadline)
            return;
        await wait(options.pollIntervalMs ?? POLL_INTERVAL_MS);
    }
}
/** The write step. It gets only what the hook pinned, and it trusts that no further than its hash. */
export async function runRecordsWrite(adapter, input, pinned, confirmedBriefHash, mode, options = {}) {
    const ctx = contextFor(input, mode);
    const step = options.onStep ?? (() => undefined);
    const off = lockProblem(ctx);
    if (off !== null)
        return { ok: false, reason: off };
    const wrongMode = modeProblem(mode, TOOL);
    if (wrongMode !== null)
        return stop(ctx, '', wrongMode);
    const opened = openPinned(pinned.planBytes);
    if ('problem' in opened)
        return stop(ctx, '', opened.problem);
    const { plan, values, planHash } = opened;
    const shape = planProblem(plan) ?? valuesProblem(plan, values);
    if (shape !== null)
        return stop(ctx, plan.orgId, shape);
    const unconfirmed = briefProblem(plan, confirmedBriefHash);
    if (unconfirmed !== null)
        return stop(ctx, plan.orgId, unconfirmed);
    if (planExpired(plan, ctx.now))
        return stop(ctx, plan.orgId, `That plan expired at ${plan.expiresAt}. Write a new plan.`);
    const ids = pinned.expected.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => !plan.frozenRecordIds.includes(id)))
        return stop(ctx, plan.orgId, 'The approved ids are not in this plan, so nothing was written.');
    const held = acquireRun(ctx.storeRoot, ctx.projectRoot, plan.id);
    if (held === null)
        return stop(ctx, plan.orgId, 'Another run for this plan is going on this machine, so nothing was written.');
    try {
        step('identity');
        const live = await writeCheck(adapter, ctx, TOOL, plan.orgId);
        if ('ok' in live)
            return stop(ctx, plan.orgId, reasonOf(live));
        const proven = live.ready;
        const { username } = proven.record;
        const limited = limitsProblem(proven, plan);
        if (limited !== null)
            return stop(ctx, plan.orgId, limited);
        const ledger = readLedger(ctx.storeRoot, ctx.projectRoot, plan.id);
        if (ledger.state === 'unreadable')
            return stop(ctx, plan.orgId, 'The ledger for this plan can not be read, so nothing was written.');
        if (ledger.state === 'started' || ledger.state === 'done' || ledger.state === 'unknown')
            return stop(ctx, plan.orgId, `This plan is ${ledger.state} since the dialog opened, so nothing was written. Nothing is re-sent on an old approval.`);
        const entry = ledger.state === 'partial' ? ledger.entry : null;
        if ((entry?.attempts.length ?? 0) !== pinned.expected.attempts)
            return stop(ctx, plan.orgId, 'This plan ran again since the dialog opened, so nothing was written. Nothing is re-sent on an old approval.');
        step('reread');
        const described = await adapter.describe(username, plan.object);
        if (isFailure(described))
            return stop(ctx, plan.orgId, `The object could not be read, so nothing was written. ${plainText(described.message, 200)}`);
        const fields = capturedFields(described, plan);
        const rows = await readRows(adapter, username, plan.object, plan.frozenRecordIds, fields);
        if (isFailure(rows))
            return stop(ctx, plan.orgId, `The frozen records could not be read, so nothing was written. ${plainText(rows.message, 200)}`);
        const records = classifyAll(plan, values, rows);
        const moved = ids.filter(id => records[id] !== 'untouched');
        if (moved.length > 0)
            return stop(ctx, plan.orgId, `${moved.length} of ${ids.length} approved records changed since the plan was read, so nothing was written. Their before-state no longer matches.`);
        if (entry === null && plan.frozenRecordIds.some(id => records[id] !== 'untouched'))
            return stop(ctx, plan.orgId, 'Some frozen records changed since the plan was read, so nothing was written.');
        const transport = transportFor(plan.operation, ids.length, retriesRefused(entry, ids));
        let payload;
        try {
            payload = transport === 'collections' ? collectionsBody(plan, values, ids) : bulkFile(plan, values, ids);
        }
        catch (error) {
            return stop(ctx, plan.orgId, error instanceof Error ? error.message : 'The write could not be built.');
        }
        step('preimage');
        // A resume keeps the old values the first attempt saved. If they are gone, the rows read now may already hold the new values.
        if (entry !== null && readPreImage(ctx.storeRoot, ctx.projectRoot, plan.id, ctx.now).state !== 'ok') {
            return stop(ctx, plan.orgId, 'The old values saved before the first attempt are gone or can not be read, and what the org holds now may be the new values. Nothing was written. Write a new plan, which saves them again.');
        }
        const at = new Date(ctx.now).toISOString();
        const line = { correlationId: plan.id, planId: plan.id, projectRoot: ctx.projectRoot, orgId: plan.orgId, mode: ctx.mode, at, object: plan.object };
        try {
            const hash = savePreImage(ctx.storeRoot, ctx.projectRoot, mergedImage(ctx, plan, planHash, transport, fields, plan.frozenRecordIds.filter(id => records[id] === 'untouched'), rows));
            appendJournal(ctx.projectRoot, { ...line, event: 'preimage.saved', hash, counts: { rows: plan.frozenRecordIds.length } });
        }
        catch (error) {
            return stop(ctx, plan.orgId, `The pre-image could not be saved, so nothing was written. ${error instanceof Error ? plainText(error.message, 200) : ''}`.trim());
        }
        step('ledger');
        const attempt = { n: (entry?.attempts.length ?? 0) + 1, ids, transport, jobId: null, startedAt: at, answered: false };
        const started = entry === null
            ? { version: 1, kind: 'records', planId: plan.id, planHash, orgId: plan.orgId, state: 'started', attempts: [attempt], records: {}, errors: {}, sideEffects: null, journaledDone: 0, updatedAt: at }
            : { ...entry, state: 'started', attempts: [...entry.attempts, attempt], updatedAt: at };
        try {
            writeLedger(ctx.storeRoot, ctx.projectRoot, started);
            appendJournal(ctx.projectRoot, { ...line, event: 'change.approved', counts: { rows: ids.length }, note: `A person approved plan ${planHash.slice(0, 12)}.` });
            appendJournal(ctx.projectRoot, { ...line, event: 'change.started', counts: { rows: ids.length }, note: transport });
            acceptAudit(ctx, proven.record, plan.id);
        }
        catch (error) {
            return stop(ctx, plan.orgId, `The ledger could not be written, so nothing was sent. ${error instanceof Error ? plainText(error.message, 200) : ''}`.trim());
        }
        // Past this line, nothing says "nothing was written" unless the org just said so.
        step('send');
        let current = started;
        let sendNote = null;
        const remember = (change, errors = {}) => {
            const attempts = current.attempts.slice();
            attempts[attempts.length - 1] = { ...attempts.at(-1), ...change };
            current = { ...current, attempts, errors: { ...current.errors, ...errors }, updatedAt: new Date(ctx.now).toISOString() };
        };
        let results = null;
        if (transport === 'collections') {
            const answer = await adapter.collectionsUpdate(username, payload, ids);
            step('sent');
            if (answer.kind === 'answered') {
                const errors = {};
                for (const row of answer.rows) {
                    // The rest of the batch rolled back with it. Those records did nothing wrong, and the re-read shows them untouched.
                    const real = row.errors.find(item => item.statusCode !== 'ALL_OR_NONE_OPERATION_ROLLED_BACK');
                    if (!row.success && real !== undefined)
                        errors[row.id] = { code: plainText(real.statusCode, 80), fields: real.fields.map(field => plainText(field, 120)) };
                }
                results = () => remember({ answered: true }, errors);
            }
            else if (answer.kind === 'rejected') {
                sendNote = `The org turned the write down as a whole: ${plainText(answer.failure.message, 200)}`;
                results = () => remember({ answered: true });
            }
            else
                sendNote = `The answer to the write could not be read, so the result comes from reading the records again. ${plainText(answer.message, 200)}`;
        }
        else {
            const job = await adapter.bulkStart(username, plan.operation, plan.object, payload);
            if (isFailure(job)) {
                sendNote = `The bulk job may or may not have started: ${plainText(job.message, 200)}`;
                step('sent');
            }
            else {
                // On disk before the first poll, so a death from here on can still find the job.
                remember({ jobId: job.jobId });
                writeLedger(ctx.storeRoot, ctx.projectRoot, current);
                appendJournal(ctx.projectRoot, { ...line, event: 'change.started', jobId: job.jobId, counts: { rows: ids.length }, note: transport });
                step('sent');
                await pollJob(adapter, username, job.jobId, options);
            }
        }
        if (results !== null)
            results();
        step('results');
        writeLedger(ctx.storeRoot, ctx.projectRoot, current);
        step('reconcile');
        const rec = await reconcileRecords(adapter, { projectRoot: ctx.projectRoot, storeRoot: ctx.storeRoot, now: ctx.now, mode: ctx.mode, correlationId: plan.id }, username, plan, values, planHash, { state: 'started', entry: current });
        step('identity-after');
        const after = await identityAfter(adapter, ctx, proven);
        const final = readLedger(ctx.storeRoot, ctx.projectRoot, plan.id);
        const finalEntry = final.state === 'missing' || final.state === 'unreadable' ? null : final.entry;
        let outcome = { ...rec, note: rec.note ?? sendNote };
        if (after !== null) {
            outcome = { ...outcome, status: 'unknown', note: after.note ?? outcome.note, wrongOrg: after.wrongOrg };
            if (finalEntry !== null)
                writeLedger(ctx.storeRoot, ctx.projectRoot, { ...finalEntry, state: 'unknown', ...(after.wrongOrg !== null ? { wrongOrg: after.wrongOrg } : {}), ...(after.note !== null ? { note: after.note } : {}) });
        }
        step('finish');
        return resultOf(ctx, TOOL, proven, withConflicts(values, reconcileData(plan, outcome)), true);
    }
    finally {
        held.release();
    }
}
/** Null means the org is still the one registered. */
async function identityAfter(adapter, ctx, proven) {
    const live = await adapter.liveOrg(proven.record.username);
    if (isFailure(live))
        return { wrongOrg: null, note: `Identity after the write could not be read, so this result can't be called clean. ${plainText(live.message, 200)}` };
    const compared = compareLive(proven.record, live);
    if (compared.ok && sameId(live.orgId, proven.record.orgId))
        return null;
    const wrongOrg = `Written to the wrong org. This was approved for ${plainText(proven.record.name, 80)} (${proven.record.orgId}), and the login now reaches ${plainText(live.name, 80)} (${live.orgId}). ${plainText(compared.ok ? '' : compared.message, 200)}`.trim();
    journalRefusal(ctx, proven.record.orgId, wrongOrg);
    return { wrongOrg, note: null };
}
