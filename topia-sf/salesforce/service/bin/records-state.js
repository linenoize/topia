import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isFailure } from './adapter.js';
import { plainText, REVERSIBILITY_TEXT } from './contract.js';
import { to18 } from './identity.js';
import { appendJournal, readJournal } from './journal.js';
import { readLedger, writeLedger } from './ledger.js';
import { localDirectory } from './paths.js';
import { readPreImage } from './preimage.js';
import { chunked, READ_CHUNK } from './preview.js';
/**
 * Contract section 9, reconcile. It reads and classifies. It never sends anything,
 * so anything may call it at any time. Each record is judged alone, against the
 * state the plan froze: done, untouched, changed by someone else, or missing.
 * Anything this can't decide is `unknown`, and `unknown` is never re-sent.
 */
export const RUNNING_JOB_STATES = ['Open', 'UploadComplete', 'InProgress'];
export const FINISHED_JOB_STATES = ['JobComplete', 'Failed', 'Aborted'];
/** A request with no answer may still land. After this long with nothing to see, it didn't. */
export const SETTLE_MS = 15 * 60 * 1000;
const LISTED = 50;
const ID_SHAPE = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const NUMERIC_TYPES = new Set(['int', 'long', 'double', 'currency', 'percent']);
const MOMENT_TYPES = new Set(['date', 'datetime']);
const ID_TYPES = new Set(['id', 'reference']);
/**
 * Whether the org holds what was sent. The org does not always keep it as sent: it
 * answers with 18 character ids for the 15 character ones a request may carry, it
 * stores a multi-select picklist in definition order, and it stores an empty string
 * as null. The field type the plan stored says which of those applies, and a looser
 * reading is for the types that have one. A text field is compared as text, so "007"
 * is not 7, "1e2" is not 100, and 15 letters are not an id. Without a type, or with one that
 * has no looser form, two values match only when they are the same.
 */
export function sameValue(left, right, type) {
    let a = left ?? null;
    let b = right ?? null;
    if (a === '')
        a = null;
    if (b === '')
        b = null;
    if (a === b)
        return true;
    if (a === null || b === null)
        return false;
    if (type === undefined)
        return false;
    if (typeof a === 'string' && typeof b === 'string') {
        // The 15 and 18 character forms of one id are one id. Two different ids never match.
        if (ID_TYPES.has(type) && a.length !== b.length && ID_SHAPE.test(a) && ID_SHAPE.test(b) && to18(a) === to18(b))
            return true;
        if (type === 'multipicklist') {
            const set = (text) => [...new Set(text.split(';'))].sort().join(';');
            return set(a) === set(b);
        }
        if (type === 'textarea')
            return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
    }
    if (NUMERIC_TYPES.has(type)) {
        if (typeof a === 'boolean' || typeof b === 'boolean')
            return false;
        const x = Number(a);
        const y = Number(b);
        return !Number.isNaN(x) && !Number.isNaN(y) && String(a).trim() !== '' && String(b).trim() !== '' && x === y;
    }
    if (type === 'boolean')
        return String(a).toLowerCase() === String(b).toLowerCase();
    if (MOMENT_TYPES.has(type) && typeof a === 'string' && typeof b === 'string') {
        // The same moment, written two ways by two APIs.
        const moment = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
        if (moment.test(a) && moment.test(b))
            return Date.parse(a.replace(/\+0000$/, 'Z')) === Date.parse(b.replace(/\+0000$/, 'Z'));
    }
    return false;
}
export function intendedFor(values, id) {
    const own = values.perRecord?.[id];
    if (own !== undefined)
        return own;
    return Object.fromEntries((values.changes ?? []).map(change => [change.field, change.value]));
}
export function classifyRecord(plan, values, before, row) {
    if (plan.operation === 'delete') {
        if (row === undefined)
            return 'done';
        return before !== undefined && sameValue(row.SystemModstamp, before.systemModstamp, 'datetime') ? 'untouched' : 'changed';
    }
    if (row === undefined)
        return 'missing';
    if (before !== undefined && sameValue(row.SystemModstamp, before.systemModstamp, 'datetime'))
        return 'untouched';
    const intended = intendedFor(values, to18(String(row.Id)));
    const atIntended = Object.entries(intended).every(([field, value]) => sameValue(row[field], value, values.fieldTypes?.[field]));
    return atIntended ? 'done' : 'changed';
}
/** Null fields mean what SOQL says. A row the org didn't return isn't in the map. */
export async function readRows(adapter, username, object, ids, fields) {
    const select = [...new Set(['Id', 'SystemModstamp', ...fields])].join(', ');
    const rows = new Map();
    for (const part of chunked(ids, READ_CHUNK)) {
        const read = await adapter.query(username, `SELECT ${select} FROM ${object} WHERE Id IN (${part.map(id => `'${id}'`).join(', ')})`);
        if (isFailure(read))
            return read;
        if (read.truncated)
            return { failure: 'unknown', message: 'The org returned only part of these records, so they can not be judged.' };
        for (const row of read.records)
            rows.set(to18(String(row.Id)), row);
    }
    return rows;
}
function emptyCounts(total) {
    return { total, done: 0, untouched: 0, changed: 0, missing: 0, failed: 0 };
}
export function countOf(records, total) {
    const counts = emptyCounts(total);
    for (const state of Object.values(records))
        counts[state] += 1;
    return counts;
}
/** Quoted fields, doubled quotes, and either line ending, which is all a bulk result file holds. */
export function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let at = 0; at < text.length; at += 1) {
        const char = text.charAt(at);
        if (quoted) {
            if (char === '"' && text.charAt(at + 1) === '"') {
                field += '"';
                at += 1;
            }
            else if (char === '"')
                quoted = false;
            else
                field += char;
        }
        else if (char === '"')
            quoted = true;
        else if (char === ',') {
            row.push(field);
            field = '';
        }
        else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        }
        else if (char !== '\r')
            field += char;
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}
/** Failed rows, by id. The code stays, and the org's message stays in the file, because a message can quote a value. */
function failedRows(file) {
    const [header, ...rows] = parseCsv(readFileSync(file, 'utf8'));
    if (header === undefined)
        return {};
    const errorAt = header.indexOf('sf__Error');
    const idAt = header.indexOf('Id');
    const systemIdAt = header.indexOf('sf__Id');
    const out = {};
    for (const row of rows) {
        const id = row[idAt] || row[systemIdAt] || '';
        if (id.length === 0)
            continue;
        out[to18(id)] = { code: plainText(String(row[errorAt] ?? '').split(':')[0] ?? 'UNKNOWN', 80), fields: [] };
    }
    return out;
}
export const RATE_LIMIT_NOTE = "The org's API rate limit was reached while this was running. Some records may already be written, and a job keeps running in the org. Nothing here says none were.";
function failureNote(what, failure) {
    return failure.failure === 'rate-limit' ? RATE_LIMIT_NOTE : `${what} could not be read, so this can't be decided: ${plainText(failure.message, 200)}`;
}
/** The ledger can vanish and the journal may not have. It's the only other place the job id is written. */
function recoverAttempt(projectRoot, plan) {
    let lines;
    try {
        lines = readJournal(projectRoot, plan.id);
    }
    catch {
        return null;
    }
    const started = lines.filter(line => line.event === 'change.started');
    const first = started[0];
    if (first === undefined)
        return null;
    const jobId = started.map(line => line.jobId).filter((id) => typeof id === 'string').pop() ?? null;
    return { n: 1, ids: plan.frozenRecordIds, transport: jobId !== null ? 'bulk' : first.note === 'bulk' ? 'bulk' : 'collections', jobId, startedAt: first.at, answered: false };
}
/** Target fields that aren't what was intended, and captured fields that moved. Counts only: no value leaves here. */
function sideEffectsOf(plan, values, rows, records, image) {
    if (plan.operation === 'delete')
        return {};
    if (image === null)
        return null;
    const before = new Map(image.records.map(item => [item.id, item.values]));
    const targets = new Set(plan.changedFields);
    const moved = {};
    for (const [id, state] of Object.entries(records)) {
        if (state !== 'done' && state !== 'changed')
            continue;
        const row = rows.get(id);
        const old = before.get(id);
        if (row === undefined || old === undefined)
            continue;
        const intended = intendedFor(values, id);
        for (const field of image.fields) {
            const differs = targets.has(field) ? !sameValue(row[field], intended[field], values.fieldTypes?.[field]) : !sameValue(row[field], old[field], values.fieldTypes?.[field]);
            if (differs)
                moved[field] = (moved[field] ?? 0) + 1;
        }
    }
    return moved;
}
/**
 * Reads the job, if there is one, then every frozen id, and writes what it found to
 * the ledger. An unreadable ledger is left as it is: it's evidence, and it stays a
 * stop. The records it reports are what the org says now, whatever any file says.
 */
export async function reconcileRecords(adapter, ctx, username, plan, values, planHash, read = readLedger(ctx.storeRoot, ctx.projectRoot, plan.id)) {
    const entry = read.state === 'missing' || read.state === 'unreadable' ? null : read.entry;
    const attempt = entry?.attempts.at(-1) ?? recoverAttempt(ctx.projectRoot, plan);
    const errors = { ...(entry?.errors ?? {}) };
    let answered = attempt?.answered === true;
    let note = null;
    let jobState = null;
    const base = { attempt, transport: attempt?.transport ?? null, jobId: attempt?.jobId ?? null, wrongOrg: entry?.wrongOrg ?? null };
    if (attempt?.transport === 'bulk' && attempt.jobId !== null && !answered) {
        const job = await adapter.bulkJob(username, attempt.jobId);
        if (isFailure(job))
            note = failureNote('The bulk job', job);
        else if (job.object !== plan.object || job.operation !== plan.operation)
            note = `The job ${attempt.jobId} is not this plan's: it is ${plainText(`${job.operation} on ${job.object}`, 80)}.`;
        else if (RUNNING_JOB_STATES.includes(job.state))
            return { ...base, status: 'started', counts: null, records: entry?.records ?? {}, errors, sideEffects: null, note: `The bulk job is ${job.state}. It keeps running in the org whether or not anything here is watching.`, jobState: job.state };
        else if (FINISHED_JOB_STATES.includes(job.state)) {
            jobState = job.state;
            const dir = localDirectory(ctx.storeRoot, ctx.projectRoot, 'results');
            const results = await adapter.bulkResults(username, attempt.jobId, dir);
            if (isFailure(results))
                note = failureNote('The bulk results', results);
            else {
                answered = true;
                if (results.failedFile !== null && existsSync(join(dir, results.failedFile)))
                    Object.assign(errors, failedRows(join(dir, results.failedFile)));
                if (job.state !== 'JobComplete')
                    note = `The bulk job ended as ${job.state}. What it processed stays processed, and Salesforce doesn't roll it back.`;
            }
        }
        else
            note = `The bulk job is in a state this version doesn't recognize: ${plainText(job.state, 40)}.`;
    }
    const image = readPreImage(ctx.storeRoot, ctx.projectRoot, plan.id, ctx.now);
    const captured = image.state === 'ok' ? image.image : null;
    const rows = await readRows(adapter, username, plan.object, plan.frozenRecordIds, [...plan.changedFields, ...(captured?.fields ?? [])]);
    if (isFailure(rows)) {
        const failed = { ...base, status: read.state === 'unreadable' ? 'unreadable' : 'unknown', counts: null, records: entry?.records ?? {}, errors, sideEffects: null, note: failureNote('The records', rows), jobState };
        if (entry !== null)
            writeLedger(ctx.storeRoot, ctx.projectRoot, { ...entry, state: 'unknown', errors, note: failed.note ?? undefined, updatedAt: new Date(ctx.now).toISOString() });
        return failed;
    }
    const beforeById = new Map((values.before ?? []).map(item => [item.id, item]));
    const records = {};
    for (const id of plan.frozenRecordIds) {
        const state = classifyRecord(plan, values, beforeById.get(id), rows.get(id));
        records[id] = state === 'untouched' && errors[id] !== undefined ? 'failed' : state;
    }
    const counts = countOf(records, plan.frozenRecordIds.length);
    const sideEffects = sideEffectsOf(plan, values, rows, records, captured);
    const untouched = (ids) => ids.some(id => records[id] === 'untouched');
    let status;
    if (read.state === 'unreadable')
        status = 'unreadable';
    else if (entry?.wrongOrg !== undefined)
        status = 'unknown';
    else if (counts.done === counts.total)
        status = 'done';
    else if (attempt === null) {
        // No ledger, no journal, and nothing to say a run ever started. Only the org can speak.
        // A record at the intended value says a write may have landed. One that merely moved says the plan is stale.
        status = counts.done === 0 ? 'missing' : 'unknown';
        if (status === 'unknown')
            note = 'This plan has no ledger or journal entry, and the org shows some of these records already at the intended value. Nothing here can say what wrote them.';
    }
    else if (!answered && untouched(attempt.ids)) {
        if (attempt.transport === 'bulk') {
            status = 'unknown';
            note = note ?? 'A bulk job may have been started, and nothing here can read it. It may still be running.';
        }
        else if (ctx.now - Date.parse(attempt.startedAt) < SETTLE_MS) {
            status = 'unknown';
            note = note ?? 'The write got no answer, and it may still land. Read it again in a few minutes.';
        }
        else
            status = 'partial';
    }
    else
        status = 'partial';
    const at = new Date(ctx.now).toISOString();
    if (read.state !== 'unreadable' && status !== 'missing') {
        const journaledDone = entry?.journaledDone ?? 0;
        const next = {
            version: 1,
            kind: 'records',
            planId: plan.id,
            planHash,
            orgId: plan.orgId,
            state: status,
            attempts: entry?.attempts ?? (attempt !== null ? [attempt] : []),
            records,
            errors,
            sideEffects,
            journaledDone: Math.max(journaledDone, counts.done),
            updatedAt: at,
            ...(note !== null ? { note } : {}),
            ...(entry?.wrongOrg !== undefined ? { wrongOrg: entry.wrongOrg } : {}),
        };
        if (answered && next.attempts.length > 0) {
            const attempts = next.attempts.slice();
            attempts[attempts.length - 1] = { ...attempts.at(-1), answered: true };
            next.attempts = attempts;
        }
        writeLedger(ctx.storeRoot, ctx.projectRoot, next);
        if (counts.done > journaledDone) {
            appendJournal(ctx.projectRoot, { event: 'change.executed', correlationId: plan.id, planId: plan.id, projectRoot: ctx.projectRoot, orgId: plan.orgId, mode: ctx.mode, at, object: plan.object, status, counts: { rows: counts.done - journaledDone } });
        }
    }
    return { ...base, status, counts, records, errors, sideEffects, note, jobState };
}
const NEXT = {
    done: 'Every record is written. Nothing else runs.',
    partial: "Partial. Nothing is re-sent on its own. A retry fires automation again, so if the person wants one, sf_records_execute opens a new dialog over what's left.",
    unknown: 'Unknown, and nothing was re-sent. /topia-sf:verify reads it again. If it never settles, a new plan over fresh ids covers what remains.',
    started: 'Still running in the org. Nothing was re-sent. Call this again, or /topia-sf:verify, to pick it up.',
    unreadable: "The ledger can't be read, so this plan stops here, and nothing was re-sent. The counts come from the org. A new plan over fresh ids covers what remains.",
    missing: 'Nothing has been written under this plan, as far as the org shows.',
};
export const RESTORE_OFFER = `Restoring is a new plan with its own dialog, through /topia-sf:restore. ${REVERSIBILITY_TEXT.restorable}`;
export const DELETE_GUIDANCE = `${REVERSIBILITY_TEXT['recycle-bin']} /topia-sf:restore checks with --all-rows whether each record is still in the bin.`;
/** What goes back to the model: ids, counts, and codes. No value and no org message. */
export function reconcileData(plan, rec) {
    const pick = (state) => Object.entries(rec.records).filter(([, value]) => value === state).map(([id]) => id).slice(0, LISTED);
    const hasOffer = rec.status === 'done' || rec.status === 'partial';
    return {
        planId: plan.id,
        status: rec.status,
        counts: rec.counts,
        transport: rec.transport,
        jobId: rec.jobId,
        jobState: rec.jobState,
        failures: Object.entries(rec.errors).filter(([id]) => rec.records[id] !== 'done').slice(0, LISTED).map(([id, item]) => ({ id, code: item.code, fields: item.fields })),
        changed: pick('changed'),
        missing: pick('missing'),
        listedAtMost: LISTED,
        sideEffects: rec.sideEffects,
        sideEffectsNote: rec.sideEffects === null ? 'No pre-image is here to compare against, so other fields were not compared.' : 'Fields that moved beyond what was intended: automation, or someone else. Counts only.',
        note: rec.note,
        wrongOrg: rec.wrongOrg,
        ...(hasOffer ? { restore: plan.operation === 'delete' ? DELETE_GUIDANCE : RESTORE_OFFER } : {}),
        next: NEXT[rec.status],
    };
}
