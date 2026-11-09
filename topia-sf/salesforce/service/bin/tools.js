import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { lockState } from './activation.js';
import { isFailure } from './adapter.js';
import { TOOL_NAMES, classLabel, formatIdentity, plainText, writerLoginSteps, writerLogoutReminder } from './contract.js';
import { classFromLive, compareLive, hostOf, sameId } from './identity.js';
import { issue, noticeText, showsContinue } from './issues.js';
import { appendJournal } from './journal.js';
import { UnreadableFileError } from './json-file.js';
import { effectiveMode, modeAllowsTool, needsBrief, toolRefusal } from './modes.js';
import { sweepProjectLogs } from './log-retention.js';
import { ORG_TEXT_CLOSE, ORG_TEXT_NOTICE, ORG_TEXT_OPEN, sanitizeOrgValue } from './org-text.js';
import { sessionKey } from './paths.js';
import { proposeBrief, readBrief } from './brief.js';
import { deploymentValidate, deploymentVerify } from './deploy.js';
import { isRetrievable, WITHHELD_NOTE } from './metadata-types.js';
import { dependencyReport } from './dependency.js';
import { deploymentPlan, practiceRecord, recordsPlanUpdate } from './plan-tools.js';
import { recordsPreview } from './preview.js';
import { stripComputedPlanFields } from './plans.js';
import { takeStamp } from './stamp.js';
import { redactValue } from './redact.js';
import { effectiveLimits, findRegistered, listOrgRecords, readWriter, setWriterLogin, writeTargetOf, writeWarningFor } from './registry.js';
import { hashContent } from './sf-adapter.js';
import { parseReportDescribe, parseReportRun } from './sf-parse.js';
import { buildRecordsQuery, cellIsSafe, describeForModel, escapeLike, escapeSoqlString, resolveQuery } from './soql.js';
import { updateStore } from './store.js';
import { TOOL_SCHEMAS, validateArgs } from './tool-schemas.js';
import { attachVendorNotes, vendorTool } from './vendor.js';
export const REST_API_VERSION = 'v66.0';
const MAX_TEXT_CHARS = 40_000;
const CANDIDATE_LIMIT = 20;
const AUDIT_DEFAULT_LIMIT = 200;
export { ORG_TEXT_CLOSE, ORG_TEXT_NOTICE, ORG_TEXT_OPEN } from './org-text.js';
/** The one choke point: every result, success or refusal, passes here on its way out. */
function finish(result) {
    return redactValue(result);
}
/** The same fixed notice and delimiter on every tool. The org's name is org text too, so nothing an org wrote sits outside the block. */
export function formatToolText(result) {
    const body = JSON.stringify(sanitizeOrgValue({ ...result, identityText: plainText(result.identityText, 300) }), null, 2);
    return [ORG_TEXT_NOTICE, ORG_TEXT_OPEN, body, ORG_TEXT_CLOSE].join('\n');
}
function journal(ctx, line) {
    appendJournal(ctx.projectRoot, { correlationId: ctx.correlationId, projectRoot: ctx.projectRoot, mode: ctx.mode, at: new Date(ctx.now).toISOString(), ...line });
}
function journalRefusal(ctx, orgId, note) {
    try {
        journal(ctx, { event: 'refusal', orgId, note });
    }
    catch {
        // A refusal stands whether or not the journal could take it.
    }
}
/** A refusal in a project with no lock leaves nothing behind in that project. */
export function refuse(ctx, tool, orgId, user, message, options = {}) {
    if (options.record !== false)
        journalRefusal(ctx, orgId, options.note ?? message);
    return finish({
        identityText: `Salesforce  ${message}`,
        correlationId: ctx.correlationId,
        orgId,
        user,
        mode: ctx.mode,
        tool,
        sideEffect: false,
        ok: false,
        data: options.data ?? { message },
    });
}
function orgIdentityHash(orgId, user, isSandbox) {
    return `${orgId}|${user}|${classFromLive(isSandbox)}`;
}
/** A live check replaces the identity. It leaves the last audit comparison where it is, because that is a different question. */
function writeSnapshot(ctx, snapshot) {
    updateStore(ctx.storeRoot, data => {
        const key = sessionKey(ctx.projectRoot);
        const audit = data[key]?.audit;
        data[key] = redactValue(audit === undefined ? snapshot : { ...snapshot, audit });
    });
}
/** `note` is what the journal keeps, when the message holds text from the CLI or the org. */
function blocked(ctx, tool, record, orgId, kind, message, note) {
    const item = issue({ kind, orgId, orgName: record?.name ?? 'unknown', user: record?.username ?? '', operationClass: 'read', message });
    journalRefusal(ctx, orgId, note ?? message);
    if (record !== null) {
        writeSnapshot(ctx, { identity: null, issue: item, orgIdentityHash: orgIdentityHash(orgId, record.username, record.isSandbox), checkedAt: new Date(ctx.now).toISOString(), writeWarning: writeWarningFor(record) });
    }
    return finish({
        identityText: `Salesforce  ${plainText(item.orgName, 80)}  ${orgId}: identity not confirmed`,
        correlationId: ctx.correlationId,
        orgId,
        user: item.user,
        mode: ctx.mode,
        tool,
        sideEffect: false,
        ok: false,
        untrusted: true,
        issue: item,
        canContinue: showsContinue(kind),
        notice: noticeText(item),
    });
}
function rateLimited(ctx, tool, orgId, user) {
    return refuse(ctx, tool, orgId, user, 'Rate limit. Nothing changed and the call was not retried.', { data: { rateLimit: true } });
}
/** A failure on the identity check. Anything but a known auth failure is `unknown`, which is never acknowledgeable. */
function identityFailure(ctx, tool, record, failure) {
    switch (failure.failure) {
        case 'rate-limit':
            return rateLimited(ctx, tool, record.orgId, record.username);
        case 'expired-auth':
            return blocked(ctx, tool, record, record.orgId, 'expired-auth', 'The Salesforce login has expired or is missing. A person logs in again with the Salesforce CLI, then retries.');
        default:
            return blocked(ctx, tool, record, record.orgId, 'unknown', `Identity could not be checked. ${failure.message}`, 'Identity could not be checked.');
    }
}
/** A failure on the data call itself, after identity passed. Denied and not-found are answers, and they differ from empty. */
export function dataFailure(ctx, tool, ready, failure) {
    switch (failure.failure) {
        case 'rate-limit':
            return rateLimited(ctx, tool, ready.record.orgId, ready.record.username);
        case 'denied':
        case 'not-found':
            return finish({ ...base(ctx, tool, ready), ok: false, untrusted: true, data: { access: failure.failure, message: failure.message } });
        case 'expired-auth':
            return blocked(ctx, tool, ready.record, ready.record.orgId, 'expired-auth', 'The Salesforce login has expired or is missing. A person logs in again with the Salesforce CLI, then retries.');
        default:
            return blocked(ctx, tool, ready.record, ready.record.orgId, 'unknown', `The result could not be read. ${failure.message}`, 'The result could not be read.');
    }
}
function base(ctx, tool, ready) {
    return {
        identityText: ready.identityText,
        correlationId: ctx.correlationId,
        orgId: ready.record.orgId,
        user: ready.record.username,
        mode: ctx.mode,
        tool,
        sideEffect: false,
        ok: true,
    };
}
export function okResult(ctx, tool, ready, data, extra = {}) {
    if (extra.item !== undefined)
        writeSnapshot(ctx, snapshotOf(ctx, ready.record, ready.live, extra.item));
    return finish({
        ...base(ctx, tool, ready),
        ok: extra.ok ?? true,
        untrusted: true,
        data,
        ...(extra.item !== undefined ? { issue: extra.item, canContinue: showsContinue(extra.item.kind), notice: noticeText(extra.item) } : {}),
    });
}
/** A refusal that carries an issue. It is on the result, so the model and the band read the same thing. */
export function finishWithIssue(ctx, tool, proven, item, message) {
    journalRefusal(ctx, item.orgId, message);
    return finish({ ...base(ctx, tool, proven), ok: false, issue: item, canContinue: showsContinue(item.kind), notice: noticeText(item), data: { message } });
}
function snapshotOf(ctx, record, live, item) {
    const identity = { classification: classFromLive(live.isSandbox), orgName: plainText(live.name, 80), orgId: record.orgId, user: record.username, mode: ctx.mode };
    return { identity, issue: item, orgIdentityHash: orgIdentityHash(record.orgId, record.username, live.isSandbox), checkedAt: new Date(ctx.now).toISOString(), writeWarning: writeWarningFor(record) };
}
/**
 * An acknowledgement rides one stamped call, from $.state, and no file can grant
 * one. It has to match what the check just found, for this org and this user, and
 * an org id change or an unknown is never in the running.
 */
function acknowledged(ctx, kind, record, live) {
    const ack = ctx.stamp?.ack;
    if (ack === undefined || ack === null || !showsContinue(kind) || ack.kind !== kind)
        return false;
    return sameId(ack.orgId, record.orgId) && ack.user.toLowerCase() === record.username.toLowerCase() && ack.orgIdentityHash === orgIdentityHash(record.orgId, record.username, live.isSandbox);
}
/**
 * Finds the registered org and proves it live, once per call. The identity is from
 * this check, never from a file. `as` is the writer, for the few callers that act as it.
 */
export async function ready(adapter, ctx, tool, orgId, full, as) {
    const found = findRegistered(ctx.storeRoot, ctx.projectRoot, orgId);
    if ('missing' in found)
        return blocked(ctx, tool, null, orgId, 'org-id-mismatch', found.missing);
    const { entry } = found;
    const record = as ?? found.record;
    const live = await adapter.liveOrg(record.username);
    if (isFailure(live))
        return identityFailure(ctx, tool, record, live);
    const compared = compareLive(record, live, full ?? {});
    if (!compared.ok && !acknowledged(ctx, compared.kind, record, live))
        return blocked(ctx, tool, record, record.orgId, compared.kind, compared.message);
    const snapshot = snapshotOf(ctx, record, live, null);
    writeSnapshot(ctx, snapshot);
    return { entry, record, live, identityText: formatIdentity({ ...snapshot.identity, operation: tool }) };
}
export function isReady(value) {
    return 'live' in value;
}
const PLAN_TOOLS = ['records_plan_update', 'deployment_plan'];
function briefRefusal(tool, briefId) {
    return typeof briefId === 'string' ? `${tool} needs a brief a person has confirmed, and this one isn't confirmed. Call sf_brief_confirm with this briefId. A chat reply is not confirmation.` : `${tool} needs a briefId. Call brief_propose first, then sf_brief_confirm where it exists.`;
}
/** Confirmation is enforced here, not by prompt text. With no stamp there is no way to confirm, so the call runs and says so. */
function checkBrief(ctx, tool, given) {
    if (typeof given.briefId !== 'string')
        return { refused: briefRefusal(tool, undefined) };
    const stored = readBrief(ctx.storeRoot, ctx.projectRoot, given.briefId);
    if (stored === null)
        return { refused: `No brief has the id ${given.briefId}. Call brief_propose first.` };
    if (ctx.stamp === null)
        return { hash: stored.briefHash, confirmed: false };
    if (ctx.stamp.confirmedBriefHash !== stored.briefHash)
        return { refused: briefRefusal(tool, given.briefId) };
    return { hash: stored.briefHash, confirmed: true };
}
export async function callTool(adapter, name, args, input) {
    const taken = takeStamp(args, input.hookHost === true);
    const stamp = taken.stamp;
    const mode = effectiveMode(stamp?.mode, stamp?.agentId);
    let ctx = { ...input, mode, stamp, brief: null };
    if (!TOOL_NAMES.includes(name))
        return refuse(ctx, name, '', '', 'That tool is not part of the Salesforce service.', { record: false });
    const tool = name;
    // What the code computes on a plan is dropped, not refused: a model may well send it, and it means nothing.
    const sent = PLAN_TOOLS.includes(tool) && taken.args !== null && typeof taken.args === 'object' && !Array.isArray(taken.args) ? stripComputedPlanFields(taken.args) : taken.args;
    const given = (sent ?? {});
    const orgId = typeof given.orgId === 'string' ? given.orgId : '';
    try {
        const lock = lockState(ctx.storeRoot, ctx.projectRoot);
        if (lock.state === 'off')
            return refuse(ctx, tool, orgId, '', 'This project is not activated. Another project stays off. /topia:sf:enable turns it on for this one.', { record: false });
        if (lock.state === 'unreadable')
            return refuse(ctx, tool, orgId, '', lock.message, { record: false });
        if (taken.problem !== null)
            return refuse(ctx, tool, orgId, '', taken.problem);
        const problem = validateArgs(TOOL_SCHEMAS[tool].inputSchema, sent ?? {});
        if (problem !== null)
            return refuse(ctx, tool, orgId, '', problem);
        if (stamp !== null && !modeAllowsTool(mode, tool))
            return refuse(ctx, tool, orgId, '', `${tool} does not run in ${mode} mode. ${toolRefusal(tool, null) ?? ''}`.trim());
        if (needsBrief(tool, given)) {
            const checked = checkBrief(ctx, tool, given);
            if ('refused' in checked)
                return refuse(ctx, tool, orgId, '', checked.refused);
            ctx = { ...ctx, brief: checked };
        }
        sweepProjectLogs(ctx.storeRoot, ctx.projectRoot, ctx.now);
        const result = await dispatch(adapter, tool, given, ctx);
        const noted = await attachVendorNotes(result, tool, given, adapter, ctx);
        const final = noted === result ? result : finish(noted);
        return ctx.brief === null ? final : { ...final, briefConfirmed: ctx.brief.confirmed };
    }
    catch (error) {
        // Unreadable files and anything unforeseen refuse. Nothing here falls open.
        const message = error instanceof UnreadableFileError ? error.message : `The call failed: ${error instanceof Error ? error.message : 'unknown error'}`;
        return refuse(ctx, tool, orgId, '', message, { note: error instanceof UnreadableFileError ? 'A local file could not be read.' : 'The call failed.' });
    }
}
function gateFor(adapter, tool, ctx) {
    return {
        check: orgId => ready(adapter, ctx, tool, orgId),
        isReady,
        ok: (checked, data, item) => okResult(ctx, tool, checked, data, { item }),
        refuse: (orgId, user, message, data) => refuse(ctx, tool, orgId, user, message, { data: data === undefined ? undefined : { message, ...data } }),
        failed: (checked, failure) => dataFailure(ctx, tool, checked, failure),
        local: data => finish({ identityText: 'Salesforce  Vendor notes in this project. No org was read.', correlationId: ctx.correlationId, orgId: '', user: '', mode: ctx.mode, tool, sideEffect: false, ok: true, untrusted: true, data }),
    };
}
function dispatch(adapter, tool, args, ctx) {
    switch (tool) {
        case 'org_inspect':
            return inspect(adapter, args, ctx);
        case 'schema_describe':
            return schemaDescribe(adapter, args, ctx);
        case 'records_query':
            return recordsQuery(adapter, args, ctx);
        case 'users_resolve':
            return usersResolve(adapter, args, ctx);
        case 'audit_query':
            return auditQuery(adapter, args, ctx);
        case 'reports_describe':
            return reportsDescribe(adapter, args, ctx);
        case 'reports_run':
            return reportsRun(adapter, args, ctx);
        case 'metadata_retrieve':
            return metadataRetrieve(adapter, args, ctx);
        case 'metadata_diff':
            return metadataDiff(adapter, args, ctx);
        case 'brief_propose':
            return briefPropose(args, ctx);
        case 'practice_record':
            return practiceRecord(args, ctx);
        case 'records_plan_update':
            return recordsPlanUpdate(adapter, args, ctx);
        case 'deployment_plan':
            return deploymentPlan(adapter, args, ctx);
        case 'records_preview':
            return recordsPreview(adapter, args, ctx);
        case 'deployment_validate':
            return deploymentValidate(adapter, args, ctx);
        case 'deployment_verify':
            return deploymentVerify(adapter, args, ctx);
        case 'dependency_report':
            return dependencyReport(adapter, args, ctx);
        case 'packages_inventory':
        case 'vendor_findings_list':
        case 'vendor_fingerprint':
        case 'vendor_finding_add':
        case 'vendor_finding_reverify':
            return vendorTool(adapter, tool, args, ctx, gateFor(adapter, tool, ctx));
        default: {
            const exhaustive = tool;
            return Promise.resolve(refuse(ctx, String(exhaustive), '', '', 'That tool is not part of the Salesforce service.'));
        }
    }
}
/** A result with no org behind it. It holds the model's own text, so it is not marked as org text. */
export function localResult(ctx, tool, data) {
    return finish({ identityText: 'Salesforce', correlationId: ctx.correlationId, orgId: '', user: '', mode: ctx.mode, tool, sideEffect: false, ok: true, data });
}
function briefPropose(args, ctx) {
    const at = new Date(ctx.now).toISOString();
    const { briefId, briefHash } = proposeBrief(ctx.storeRoot, ctx.projectRoot, args, at);
    appendJournal(ctx.projectRoot, { event: 'request.enhanced', correlationId: ctx.correlationId, projectRoot: ctx.projectRoot, orgId: '', mode: ctx.mode, at, note: `Brief ${briefId} proposed. Its text stays in the local store.` });
    return Promise.resolve(localResult(ctx, 'brief_propose', { briefId, briefHash, confirmed: false, next: 'Call sf_brief_confirm with this briefId. A person answers it. A chat reply is not confirmation.' }));
}
/**
 * The fresh live check a screen is built from: the CLI login, the current user,
 * and SOQL on Organization, compared with what was registered. The approval screen
 * starts here too. Every value is from this check, never from a file.
 */
export async function liveCheck(adapter, ctx, tool, orgId, as) {
    const found = findRegistered(ctx.storeRoot, ctx.projectRoot, orgId);
    if ('missing' in found)
        return blocked(ctx, tool, null, orgId, 'org-id-mismatch', found.missing);
    const record = as ?? found.record;
    const display = await adapter.display(record.username);
    if (isFailure(display))
        return identityFailure(ctx, tool, record, display);
    const user = await adapter.liveUser(record.username);
    if (isFailure(user))
        return identityFailure(ctx, tool, record, user);
    const checked = await ready(adapter, ctx, tool, orgId, { user, display }, as);
    if (!isReady(checked))
        return checked;
    const { live } = checked;
    return { ready: checked, display, user, facts: { isSandbox: live.isSandbox, orgName: plainText(live.name, 80), orgId: record.orgId, instanceHost: hostOf(display.instanceUrl), username: record.username } };
}
/** Whether a person has this writer logged in now, read from the org. A logged-out writer is how it should be, so this leaves the band alone. */
async function writerLoggedIn(adapter, ctx, writer) {
    const user = await adapter.liveUser(writer.username);
    const at = new Date(ctx.now).toISOString();
    if (isFailure(user) && user.failure !== 'expired-auth')
        return user;
    const loggedIn = !isFailure(user);
    setWriterLogin(ctx.storeRoot, ctx.projectRoot, writer.orgId, { state: loggedIn ? 'logged-in' : 'logged-out', checkedAt: at });
    return loggedIn;
}
/**
 * The live check for anything that changes an org, or runs code in one. Production
 * has to go through a writer a person just logged in, or the one user they accepted,
 * and the login itself is the part a process can't do for them.
 */
export async function writeCheck(adapter, ctx, tool, orgId) {
    const found = findRegistered(ctx.storeRoot, ctx.projectRoot, orgId);
    if ('missing' in found)
        return liveCheck(adapter, ctx, tool, orgId);
    const target = writeTargetOf(ctx.storeRoot, ctx.projectRoot, found.record);
    if ('refused' in target)
        return refuse(ctx, tool, orgId, found.record.username, target.refused);
    if (target.record.role !== 'writer')
        return liveCheck(adapter, ctx, tool, orgId);
    const loggedIn = await writerLoggedIn(adapter, ctx, target.record);
    if (loggedIn === false)
        return refuse(ctx, tool, orgId, target.record.username, `This is production, and its writer ${target.record.username} isn't logged in, so nothing changed. ${writerLoginSteps(target.record.username, target.record.instanceUrl)}`, { note: 'A production change was refused: the writer is not logged in.' });
    return liveCheck(adapter, ctx, tool, orgId, target.record);
}
/**
 * Reads go to the reader. A few checks ask what the writer can do, or did, so they use
 * it when a person has it logged in. `judged` is false when nothing here could ask:
 * what a read-only user can't edit says nothing about the user who'd make the change.
 */
export async function preferWriter(adapter, ctx, orgId) {
    const found = findRegistered(ctx.storeRoot, ctx.projectRoot, orgId);
    if ('missing' in found || found.record.isSandbox)
        return { judged: true };
    const writer = readWriter(ctx.storeRoot, ctx.projectRoot, orgId);
    if (writer === null)
        return { judged: found.record.writeAccess.canWrite !== 'no' };
    return (await writerLoggedIn(adapter, ctx, writer)) === true ? { as: writer, judged: true } : { judged: false };
}
/** A result that ran as the writer says how the login ends. The person does that, not the assistant. */
export function withWriterReminder(record, data) {
    return record.role === 'writer' ? { ...data, afterThis: writerLogoutReminder(record.username) } : data;
}
async function inspect(adapter, args, ctx) {
    let orgId = typeof args.orgId === 'string' ? args.orgId : '';
    if (orgId.length === 0) {
        const records = listOrgRecords(ctx.storeRoot, ctx.projectRoot);
        if (records.length === 0)
            return refuse(ctx, 'org_inspect', '', '', 'No org is registered for this project. /topia:sf:connect registers one.');
        if (records.length > 1) {
            return refuse(ctx, 'org_inspect', '', '', 'More than one org is registered. Name one by orgId.', { data: { message: 'More than one org is registered. Name one by orgId.', orgs: records.map(item => ({ orgId: item.orgId, name: item.name })) } });
        }
        orgId = records[0].orgId;
    }
    const inspected = await liveCheck(adapter, ctx, 'org_inspect', orgId);
    if ('ok' in inspected)
        return inspected;
    const { ready: checked, display, user } = inspected;
    const { live, entry, record } = checked;
    return okResult(ctx, 'org_inspect', checked, {
        live: {
            orgId: live.orgId,
            name: live.name,
            isSandbox: live.isSandbox,
            class: classFromLive(live.isSandbox),
            classLabel: classLabel(classFromLive(live.isSandbox)),
            organizationType: live.organizationType,
            instanceName: live.instanceName,
            instanceHost: hostOf(display.instanceUrl),
            username: user.username,
            userId: user.id,
            userActive: user.isActive,
            profile: user.profileName,
        },
        writeAccess: record.writeAccess,
        writeWarning: writeWarningFor(record),
        limits: effectiveLimits(entry),
        repo: entry.repo ?? null,
        branch: entry.branch ?? null,
        registeredAt: record.registeredAt,
    });
}
async function schemaDescribe(adapter, args, ctx) {
    const checked = await ready(adapter, ctx, 'schema_describe', args.orgId);
    if (!isReady(checked))
        return checked;
    const username = checked.record.username;
    if (args.purpose === 'candidate') {
        if (typeof args.text !== 'string')
            return refuse(ctx, 'schema_describe', checked.record.orgId, username, 'A candidate lookup needs text.');
        const rows = await adapter.query(username, `SELECT QualifiedApiName, Label FROM EntityDefinition WHERE Label LIKE '%${escapeLike(args.text)}%' ORDER BY Label LIMIT ${CANDIDATE_LIMIT}`);
        if (isFailure(rows))
            return dataFailure(ctx, 'schema_describe', checked, rows);
        journal(ctx, { event: 'query.executed', orgId: checked.record.orgId, soql: 'SELECT QualifiedApiName, Label FROM EntityDefinition WHERE Label LIKE :b0', counts: { rows: rows.records.length }, candidate: true });
        return okResult(ctx, 'schema_describe', checked, {
            candidates: rows.records.map(row => ({ apiName: row.QualifiedApiName, label: row.Label })),
            picked: null,
            note: 'A list to confirm with the person. Not a finding, and not a pick.',
        });
    }
    if (typeof args.object !== 'string')
        return refuse(ctx, 'schema_describe', checked.record.orgId, username, 'schema_describe needs an object, or purpose candidate with text.');
    const described = await adapter.describe(username, args.object);
    if (isFailure(described))
        return dataFailure(ctx, 'schema_describe', checked, described);
    return okResult(ctx, 'schema_describe', checked, describeForModel(described));
}
export function valueAt(row, path) {
    let current = row;
    for (const segment of path.split('.')) {
        if (current === null || typeof current !== 'object')
            return null;
        current = current[segment];
    }
    return current ?? null;
}
async function recordsQuery(adapter, args, ctx) {
    const checked = await ready(adapter, ctx, 'records_query', args.orgId);
    if (!isReady(checked))
        return checked;
    const { username, orgId } = checked.record;
    const describes = new Map();
    const describer = (object) => {
        if (!describes.has(object))
            describes.set(object, adapter.describe(username, object));
        return describes.get(object);
    };
    const resolved = await resolveQuery(args, describer);
    if (isFailure(resolved))
        return dataFailure(ctx, 'records_query', checked, resolved);
    if ('refused' in resolved)
        return refuse(ctx, 'records_query', orgId, username, resolved.refused, { note: 'A query did not pass the field and filter checks.' });
    const query = buildRecordsQuery(resolved);
    const recorded = (statement, counts) => journal(ctx, { event: 'query.executed', orgId, soql: statement.bound, counts });
    const count = await adapter.count(username, query.count.soql);
    if (isFailure(count))
        return dataFailure(ctx, 'records_query', checked, count);
    recorded(query.count, { rows: count.count });
    const bounded = count.count >= resolved.limit;
    let rows = [];
    let withheldCells = 0;
    let partial = false;
    if (query.rows !== null) {
        const fetched = await adapter.query(username, query.rows.soql);
        if (isFailure(fetched))
            return dataFailure(ctx, 'records_query', checked, fetched);
        recorded(query.rows, { rows: fetched.records.length });
        partial = fetched.truncated;
        rows = fetched.records.slice(0, resolved.limit).map(record => {
            const out = {};
            for (const item of resolved.safe) {
                const value = valueAt(record, item.path);
                if (cellIsSafe(item.field, value))
                    out[item.path] = value;
                else
                    withheldCells += 1;
            }
            return out;
        });
    }
    const withheld = [];
    for (const item of query.withheld) {
        if (item.soql === null) {
            withheld.push({ field: item.field.path, type: item.field.field.type, populated: null, empty: null, reason: 'Values are withheld. This field cannot be filtered, so it cannot be counted either.' });
            continue;
        }
        const populated = await adapter.count(username, item.soql);
        if (isFailure(populated))
            return dataFailure(ctx, 'records_query', checked, populated);
        recorded({ soql: item.soql, bound: item.bound }, { populated: populated.count });
        withheld.push({
            field: item.field.path,
            type: item.field.field.type,
            populated: populated.count,
            empty: bounded ? null : Math.max(count.count - populated.count, 0),
            reason: 'Values are withheld unless proven safe. Only the count comes back.',
        });
    }
    return okResult(ctx, 'records_query', checked, {
        access: 'ok',
        empty: count.count === 0,
        object: resolved.object,
        count: count.count,
        countBounded: bounded,
        limit: resolved.limit,
        returnedFields: resolved.safe.map((item) => item.path),
        rows,
        withheld,
        withheldCells,
        partial,
    });
}
async function usersResolve(adapter, args, ctx) {
    const checked = await ready(adapter, ctx, 'users_resolve', args.orgId);
    if (!isReady(checked))
        return checked;
    const text = escapeLike(args.text);
    const soql = `SELECT Id, Name, Username, IsActive, Profile.Name FROM User WHERE Name LIKE '%${text}%' OR Username LIKE '%${text}%' ORDER BY Name LIMIT ${CANDIDATE_LIMIT}`;
    const rows = await adapter.query(checked.record.username, soql);
    if (isFailure(rows))
        return dataFailure(ctx, 'users_resolve', checked, rows);
    journal(ctx, { event: 'query.executed', orgId: checked.record.orgId, soql: 'SELECT Id, Name, Username, IsActive, Profile.Name FROM User WHERE Name LIKE :b0 OR Username LIKE :b0', counts: { rows: rows.records.length }, candidate: true });
    return okResult(ctx, 'users_resolve', checked, {
        candidates: rows.records.map(row => ({
            id: row.Id,
            name: row.Name,
            username: row.Username,
            isActive: row.IsActive,
            profile: row.Profile !== null && typeof row.Profile === 'object' ? row.Profile.Name ?? null : null,
        })),
        picked: null,
        partial: rows.truncated,
        note: 'A list to confirm with the person. This never picks one, even for a single match.',
    });
}
function auditLiteral(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
        return Number.isNaN(Date.parse(value)) ? null : `${value}T00:00:00Z`;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
        return Number.isNaN(Date.parse(value)) ? null : value;
    return null;
}
async function auditQuery(adapter, args, ctx) {
    const checked = await ready(adapter, ctx, 'audit_query', args.orgId);
    if (!isReady(checked))
        return checked;
    const { username, orgId } = checked.record;
    const from = auditLiteral(args.from);
    const to = auditLiteral(args.to);
    if (from === null || to === null)
        return refuse(ctx, 'audit_query', orgId, username, 'from and to must be a date, or a date and time with an offset.');
    const limit = typeof args.limit === 'number' ? args.limit : AUDIT_DEFAULT_LIMIT;
    const head = 'SELECT Action, Section, CreatedDate, CreatedById FROM SetupAuditTrail WHERE CreatedById =';
    const rows = await adapter.query(username, `${head} '${escapeSoqlString(args.userId)}' AND CreatedDate >= ${from} AND CreatedDate <= ${to} ORDER BY CreatedDate DESC LIMIT ${limit}`);
    if (isFailure(rows))
        return dataFailure(ctx, 'audit_query', checked, rows);
    journal(ctx, { event: 'query.executed', orgId, soql: `${head} :b0 AND CreatedDate >= :b1 AND CreatedDate <= :b2 ORDER BY CreatedDate DESC LIMIT ${limit}`, counts: { rows: rows.records.length } });
    return okResult(ctx, 'audit_query', checked, {
        entries: rows.records.map(row => ({ action: row.Action, section: row.Section, at: row.CreatedDate, byId: row.CreatedById })),
        // Display is free text, and it can quote a changed email or name.
        withheld: ['Display', 'DelegateUser'],
        partial: rows.truncated,
    });
}
export function reportPath(reportId, suffix) {
    return `/services/data/${REST_API_VERSION}/analytics/reports/${reportId}${suffix}`;
}
async function reportsDescribe(adapter, args, ctx) {
    const checked = await ready(adapter, ctx, 'reports_describe', args.orgId);
    if (!isReady(checked))
        return checked;
    const answer = await adapter.apiGet(checked.record.username, reportPath(args.reportId, '/describe'));
    if (isFailure(answer))
        return dataFailure(ctx, 'reports_describe', checked, answer);
    const described = parseReportDescribe(answer);
    if (isFailure(described))
        return dataFailure(ctx, 'reports_describe', checked, described);
    return okResult(ctx, 'reports_describe', checked, described);
}
/** A report's column types are all there is to go on, so only ids and booleans can be proven. Picklists cannot: nothing here lists their values. */
function reportCellSafe(column, value) {
    if (value === null || value === undefined)
        return true;
    if (column.dataType === 'boolean')
        return typeof value === 'boolean';
    if (column.dataType === 'id')
        return typeof value === 'string' && /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(value);
    return false;
}
function reportColumnProvable(column) {
    return column.dataType === 'boolean' || column.dataType === 'id';
}
async function reportsRun(adapter, args, ctx) {
    const checked = await ready(adapter, ctx, 'reports_run', args.orgId);
    if (!isReady(checked))
        return checked;
    const answer = await adapter.apiGet(checked.record.username, reportPath(args.reportId, '?includeDetails=true'));
    if (isFailure(answer))
        return dataFailure(ctx, 'reports_run', checked, answer);
    const run = parseReportRun(answer);
    const partial = run.malformed || run.allData !== true;
    const columns = run.columns.filter(reportColumnProvable);
    const rows = run.malformed
        ? []
        : run.rows.map(cells => {
            const out = {};
            for (const [index, column] of run.columns.entries()) {
                if (reportColumnProvable(column) && reportCellSafe(column, cells[index]))
                    out[column.name] = cells[index] ?? null;
            }
            return out;
        });
    const item = partial && !run.malformed
        ? issue({ kind: 'report-row-cap', orgId: checked.record.orgId, orgName: checked.record.name, user: checked.record.username, operationClass: 'read', message: 'The org returned part of this report. Detail rows are a partial extract, and the row count may be too.' })
        : undefined;
    return okResult(ctx, 'reports_run', checked, {
        partial,
        malformed: run.malformed,
        allData: run.allData,
        rowCount: run.rowCount ?? run.rows.length,
        returnedColumns: columns.map(column => column.name),
        withheldColumns: run.columns.filter(column => !reportColumnProvable(column)).map(column => column.name),
        aggregatesWithheld: run.aggregateNames.filter(name => name !== 'RowCount'),
        rows,
    }, { item });
}
function dependencyOf(retrieved, members) {
    const blindSpots = [...retrieved.missing, ...retrieved.problems.map(item => `${item.fileName}: ${item.problem}`)];
    const missing = new Set(retrieved.missing);
    return { covered: members.filter(member => !missing.has(member)), blindSpots, partial: blindSpots.length > 0 || !retrieved.success };
}
export function partialCoverage(record) {
    return issue({ kind: 'partial-dependency-coverage', orgId: record.orgId, orgName: record.name, user: record.username, operationClass: 'read', message: 'Coverage is partial. Blind spots stay listed.' });
}
function withinBudget(files) {
    let left = MAX_TEXT_CHARS;
    let omitted = false;
    const out = files.map(file => {
        const entry = { path: file.path, bytes: file.bytes, text: file.text, redacted: file.redactions };
        if (file.text === null)
            return entry;
        if (file.text.length > left) {
            omitted = true;
            return { ...entry, text: null, omitted: true };
        }
        left -= file.text.length;
        return entry;
    });
    return { files: out, omitted };
}
const WITHHELD_FOLDER = /(?:^|\/)(?:reports|dashboards|documents|email|staticresources|contentassets|groups|queues|customMetadata)\//i;
async function metadataRetrieve(adapter, args, ctx) {
    const checked = await ready(adapter, ctx, 'metadata_retrieve', args.orgId);
    if (!isReady(checked))
        return checked;
    // Only types on the allowlist go through. What is left out is named, so it never reads as absent.
    const asked = args.members;
    const members = asked.filter(member => isRetrievable(member.slice(0, member.indexOf(':'))));
    const withheld = asked.filter(member => !members.includes(member));
    const held = withheld.length === 0 ? {} : { withheld: { members: withheld.slice(0, 50).map(member => plainText(member, 120)), count: withheld.length, types: [...new Set(withheld.map(member => plainText(member.slice(0, member.indexOf(':')), 60)))], note: WITHHELD_NOTE } };
    if (members.length === 0)
        return okResult(ctx, 'metadata_retrieve', checked, { status: 'nothing retrieved', files: [], redactions: 0, partial: true, ...held });
    const retrieved = await adapter.retrieve(checked.record.username, members);
    if (isFailure(retrieved))
        return dataFailure(ctx, 'metadata_retrieve', checked, retrieved);
    // If a retrieve brings back more than was asked for, these folders still don't go out.
    const kept = retrieved.files.filter(file => !WITHHELD_FOLDER.test(file.path.replace(/\\/g, '/')));
    const budget = withinBudget(kept);
    const dependency = dependencyOf(retrieved, members);
    return okResult(ctx, 'metadata_retrieve', checked, {
        status: retrieved.status,
        files: budget.files,
        redactions: retrieved.files.reduce((sum, file) => sum + file.redactions, 0),
        dependency,
        partial: budget.omitted || dependency.partial || withheld.length > 0,
        ...held,
    }, { ok: retrieved.success, item: dependency.partial && retrieved.success ? partialCoverage(checked.record) : undefined });
}
const MAX_LOCAL_FILES = 20_000;
function localSourceFolders(projectRoot) {
    try {
        const project = JSON.parse(readFileSync(join(projectRoot, 'sfdx-project.json'), 'utf8'));
        const folders = (project.packageDirectories ?? []).flatMap(item => (typeof item.path === 'string' ? [join(projectRoot, item.path)] : []));
        if (folders.length > 0)
            return folders;
    }
    catch {
        // No project file: the conventional folder below is the only guess, and it is reported if empty.
    }
    return [join(projectRoot, 'force-app')];
}
function walkLocal(dir, into) {
    let names;
    try {
        names = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const name of names) {
        if (into.size >= MAX_LOCAL_FILES)
            return;
        const path = join(dir, name);
        let isDirectory = false;
        try {
            isDirectory = statSync(path).isDirectory();
        }
        catch {
            continue;
        }
        if (isDirectory)
            walkLocal(path, into);
        else if (!into.has(name))
            into.set(name, path);
    }
}
function summarize(rows) {
    const summary = {};
    for (const row of rows)
        summary[row.state] = (summary[row.state] ?? 0) + 1;
    return summary;
}
function isManifest(file) {
    return basename(file.path) === 'package.xml';
}
async function metadataDiff(adapter, args, ctx) {
    const checked = await ready(adapter, ctx, 'metadata_diff', args.orgId);
    if (!isReady(checked))
        return checked;
    const members = args.members;
    const otherOrgId = typeof args.otherOrgId === 'string' ? args.otherOrgId : null;
    if (otherOrgId !== null && sameId(otherOrgId, checked.record.orgId))
        return refuse(ctx, 'metadata_diff', checked.record.orgId, checked.record.username, 'A diff needs two different orgs.');
    const left = await adapter.retrieve(checked.record.username, members);
    if (isFailure(left))
        return dataFailure(ctx, 'metadata_diff', checked, left);
    const leftFiles = left.files.filter(file => !isManifest(file));
    const dependency = dependencyOf(left, members);
    if (otherOrgId !== null) {
        const other = await ready(adapter, ctx, 'metadata_diff', otherOrgId);
        if (!isReady(other))
            return other;
        // The band stays on the org under discussion, not the one it was compared with.
        await ready(adapter, ctx, 'metadata_diff', checked.record.orgId);
        const right = await adapter.retrieve(other.record.username, members);
        if (isFailure(right))
            return dataFailure(ctx, 'metadata_diff', other, right);
        const rightFiles = new Map(right.files.filter(file => !isManifest(file)).map(file => [file.path, file]));
        const rows = leftFiles.map(file => {
            const peer = rightFiles.get(file.path);
            rightFiles.delete(file.path);
            if (peer === undefined)
                return { path: file.path, state: 'org-only' };
            return { path: file.path, state: peer.sha256 === file.sha256 ? 'same' : 'different' };
        });
        for (const path of rightFiles.keys())
            rows.push({ path, state: 'other-only' });
        const otherDependency = dependencyOf(right, members);
        return okResult(ctx, 'metadata_diff', checked, {
            against: other.record.orgId,
            againstName: other.record.name,
            files: rows,
            summary: summarize(rows),
            blindSpots: [...dependency.blindSpots, ...otherDependency.blindSpots],
            partial: dependency.partial || otherDependency.partial,
        });
    }
    const local = new Map();
    const folders = localSourceFolders(ctx.projectRoot).filter(existsSync);
    for (const folder of folders)
        walkLocal(folder, local);
    const rows = leftFiles.map(file => {
        const name = basename(file.path);
        const peer = local.get(name) ?? local.get(`${name}-meta.xml`);
        if (peer === undefined)
            return { path: file.path, state: 'org-only' };
        return { path: file.path, state: hashContent(readFileSync(peer)) === file.sha256 ? 'same' : 'different' };
    });
    return okResult(ctx, 'metadata_diff', checked, {
        against: 'working-tree',
        files: rows,
        summary: summarize(rows),
        blindSpots: [
            ...dependency.blindSpots,
            ...(folders.length === 0 ? ['No source folder was found in this project.'] : []),
            'Metadata that source format splits into many files, such as objects, reads as org-only here even when it exists locally.',
        ],
        partial: dependency.partial || folders.length === 0,
    });
}
