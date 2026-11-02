import { lockState } from './activation.js';
import { isFailure } from './adapter.js';
import { acceptAudit, auditBeforeWrite, auditFacts, auditRefusal } from './audit.js';
import { plainText } from './contract.js';
import { deployData, hasSnapshot, isRunning, noChecks, readValidation, recoverDeployEntry, retrieveManifest, settleDeploy, validationFile } from './deploy.js';
import { acceptValidation, baselineOf, componentSummary, driftBetween, readStoredZip, snapshotFile, snapshotZip, zipFile } from './deploy-zip.js';
import { sameId } from './identity.js';
import { appendJournal } from './journal.js';
import { writeFileAtomic, writeJson } from './json-file.js';
import { acquireRun, readLedger, writeLedger } from './ledger.js';
import { sweepProjectLogs } from './log-retention.js';
import { modeAllowsTool, toolRefusal } from './modes.js';
import { loadPlan } from './plan-tools.js';
import { canonical, planExpired, planHashOf, sha256 } from './plans.js';
import { effectiveLimits } from './registry.js';
import { formatToolText, okResult, withWriterReminder, writeCheck } from './tools.js';
const TOOL = 'sf_deployment_execute';
const POLL_BUDGET_MS = 6 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
const TEST_LEVEL = 'RunLocalTests';
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
    return result.notice ?? (typeof message === 'string' ? message : 'That could not be checked, so nothing shipped.');
}
function gateProblem(ctx, mode) {
    const lock = lockState(ctx.storeRoot, ctx.projectRoot);
    if (lock.state === 'off')
        return 'Salesforce is not on for this project. /topia:sf:enable turns it on.';
    if (lock.state === 'unreadable')
        return lock.message;
    return modeAllowsTool(mode, TOOL) ? null : `${TOOL} does not run in ${mode} mode. ${toolRefusal(TOOL, null) ?? ''}`.trim();
}
function briefProblem(plan, confirmedBriefHash) {
    if (confirmedBriefHash === null || plan.briefHash !== confirmedBriefHash)
        return `This plan needs a brief a person has confirmed this session. Call sf_brief_confirm with briefId ${plan.briefId} first. A chat reply is not confirmation.`;
    return null;
}
function report(ctx, proven, given, wrote) {
    const data = withWriterReminder(proven.record, given);
    const result = okResult(ctx, TOOL, proven, data);
    return { ok: true, action: 'report', text: formatToolText({ ...result, sideEffect: wrote }), data, wrote };
}
function outcomeReport(ctx, proven, plan, outcome, wrote) {
    return report(ctx, proven, deployData(plan.id, outcome, { snapshot: hasSnapshot(ctx.storeRoot, ctx.projectRoot, plan.id) }), wrote);
}
function revalidate(problems) {
    return `That validation doesn't count, so nothing shipped: ${problems} Call deployment_validate with revalidate. Nothing falls back to a full deploy.`;
}
function screenPlanFor(plan, values, planHash) {
    return { kind: 'deploy', destructive: plan.destructive, planHash, expiresAt: plan.expiresAt, businessObjective: values.businessObjective, notes: values.notes };
}
/** The dialog step. A deploy that may have landed gets a query and a report, and never a dialog. */
export async function prepareDeployWrite(adapter, input, request, confirmedBriefHash, mode) {
    const ctx = contextFor(input, mode);
    try {
        const gate = gateProblem(ctx, mode);
        if (gate !== null)
            return gate.startsWith('Salesforce') ? { ok: false, reason: gate } : stop(ctx, '', gate);
        const loaded = loadPlan(ctx.storeRoot, ctx.projectRoot, request.planId, ctx.now, { allowExpired: true });
        if (!loaded.ok)
            return stop(ctx, '', loaded.reason);
        if (loaded.plan.kind !== 'deploy')
            return stop(ctx, loaded.plan.orgId, 'That plan is not a deploy plan.');
        const plan = loaded.plan;
        const values = loaded.values;
        const unconfirmed = briefProblem(plan, confirmedBriefHash);
        if (unconfirmed !== null)
            return stop(ctx, plan.orgId, unconfirmed);
        sweepProjectLogs(ctx.storeRoot, ctx.projectRoot, ctx.now);
        const live = await writeCheck(adapter, ctx, TOOL, plan.orgId);
        if ('ok' in live)
            return { ok: false, reason: reasonOf(live) };
        const proven = live.ready;
        if (!effectiveLimits(proven.entry).allowedOperationClasses.includes('write'))
            return stop(ctx, plan.orgId, "This org's limits in orgs.json don't allow a write.");
        const ledger = readLedger(ctx.storeRoot, ctx.projectRoot, plan.id);
        const entry = await currentEntry(ctx, plan, loaded.planHash, ledger);
        if (request.cancel === true) {
            if (entry === null || entry.state !== 'started' || entry.deployId === null)
                return stop(ctx, plan.orgId, 'There is nothing to cancel: no deploy under this plan is running.');
            return {
                ok: true,
                action: 'approve',
                screenPlan: { kind: 'cancel', deployId: entry.deployId, planHash: loaded.planHash, expiresAt: plan.expiresAt, businessObjective: values.businessObjective, notes: values.notes },
                facts: { identity: live.facts, jobId: entry.deployId },
                pinned: { planBytes: JSON.stringify({ plan, values, planHash: loaded.planHash }), expected: { validationJobId: entry.validationJobId ?? '', zipHash: '', cancelDeployId: entry.deployId } },
            };
        }
        if (ledger.state === 'unreadable') {
            const recovered = entry;
            if (recovered === null)
                return report(ctx, proven, deployData(plan.id, { status: 'unreadable', entry: null, note: "The ledger can't be read, and the journal holds no deploy id. The Deployment Status page in Setup shows what happened." }, { snapshot: false }), false);
            const read = await settleDeploy({ adapter, ctx, proven, plan, user: live.user, entry: recovered, readOnly: true });
            return outcomeReport(ctx, proven, plan, { ...read, status: 'unreadable' }, false);
        }
        if (entry !== null) {
            if (entry.refused) {
                // Nothing shipped, so a new approval is on offer once it's validated again.
            }
            else if (entry.state === 'done' || entry.state === 'partial')
                return outcomeReport(ctx, proven, plan, { status: entry.state, entry, note: 'This plan already ran. Nothing was sent.' }, false);
            else {
                const held = acquireRun(ctx.storeRoot, ctx.projectRoot, plan.id);
                if (held === null)
                    return outcomeReport(ctx, proven, plan, { status: 'started', entry, note: 'Another run for this plan is going on this machine. Nothing was sent by this call.' }, false);
                try {
                    return outcomeReport(ctx, proven, plan, await settleDeploy({ adapter, ctx, proven, plan, user: live.user, entry }), false);
                }
                finally {
                    held.release();
                }
            }
        }
        if (planExpired(plan, ctx.now))
            return stop(ctx, plan.orgId, `That plan expired at ${plan.expiresAt}. Write a new plan.`);
        const audit = await auditBeforeWrite(adapter, ctx, plan.orgId, proven.record, plan.id);
        const auditStop = auditRefusal(audit, proven.record, 'nothing shipped');
        if (auditStop !== null)
            return stop(ctx, plan.orgId, auditStop);
        const validation = readValidation(ctx.storeRoot, ctx.projectRoot, plan.id);
        if (validation === null || validation.planHash !== loaded.planHash)
            return stop(ctx, plan.orgId, 'This plan has no validation yet. /topia:sf:validate runs deployment_validate first.');
        if (validation.state === 'failed')
            return stop(ctx, plan.orgId, revalidate(validation.problems.join(' ')));
        if (validation.state !== 'passed')
            return stop(ctx, plan.orgId, 'The validation for this plan has not finished. deployment_validate picks it up.');
        if ((validation.path === 'dry-run') !== live.facts.isSandbox)
            return stop(ctx, plan.orgId, revalidate('It took the path for a different class of org.'));
        const built = readStoredZip(ctx.storeRoot, ctx.projectRoot, plan.id, plan.artifactHash, validation.zipHash);
        if ('problem' in built)
            return stop(ctx, plan.orgId, built.problem);
        // The file names a job. Salesforce says what the job is.
        const job = await adapter.deployReport(live.ready.record.username, validation.jobId);
        if (isFailure(job))
            return stop(ctx, plan.orgId, revalidate(plainText(job.message, 300)));
        const problems = acceptValidation(job, { userId: live.user.id, members: built.manifest.members, destructive: built.manifest.destructive, ignoreWarnings: plan.ignoreWarnings === true, now: ctx.now });
        if (problems.length > 0)
            return stop(ctx, plan.orgId, revalidate(problems.join(' ')));
        const started = Date.parse(job.startDate ?? job.createdDate ?? '');
        const facts = {
            identity: live.facts,
            components: componentSummary(built.manifest, validation.baseline.fetched),
            testLevel: TEST_LEVEL,
            jobId: validation.jobId,
            jobAgeMs: Number.isNaN(started) ? undefined : Math.max(ctx.now - started, 0),
            ignoreWarnings: plan.ignoreWarnings === true,
            ...(plan.rollbackOf !== undefined ? { rollbackOf: plan.rollbackOf } : {}),
            ...auditFacts(audit),
        };
        return { ok: true, action: 'approve', screenPlan: screenPlanFor(plan, values, loaded.planHash), facts, pinned: { planBytes: JSON.stringify({ plan, values, planHash: loaded.planHash }), expected: { validationJobId: validation.jobId, zipHash: validation.zipHash } } };
    }
    catch (error) {
        return stop(ctx, '', error instanceof Error ? `The deploy could not be prepared, so nothing shipped. ${plainText(error.message, 300)}` : 'The deploy could not be prepared, so nothing shipped.');
    }
}
/** The ledger, or what the journal can rebuild of it when it's gone or can't be read. */
async function currentEntry(ctx, plan, planHash, ledger) {
    if (ledger.state === 'missing' || ledger.state === 'unreadable')
        return recoverDeployEntry(ctx.projectRoot, plan, planHash, new Date(ctx.now).toISOString());
    return ledger.entry.kind === 'deploy' ? ledger.entry : null;
}
function openPinned(planBytes) {
    let parsed;
    try {
        parsed = JSON.parse(planBytes);
    }
    catch {
        return { problem: 'The pinned plan could not be read, so nothing shipped.' };
    }
    const { plan, values, planHash } = parsed;
    if (plan === undefined || values === undefined || typeof planHash !== 'string' || plan.kind !== 'deploy')
        return { problem: 'The pinned plan could not be read, so nothing shipped.' };
    if (planHashOf(plan) !== planHash)
        return { problem: 'The pinned plan does not match its own hash, so nothing shipped.' };
    if (sha256(canonical(values)) !== plan.valuesHash)
        return { problem: 'The pinned values do not match the plan hash, so nothing shipped.' };
    return { plan, values, planHash };
}
function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
async function pollDeploy(adapter, username, deployId, options) {
    const deadline = Date.now() + (options.pollBudgetMs ?? POLL_BUDGET_MS);
    for (;;) {
        const job = await adapter.deployReport(username, deployId);
        if (isFailure(job) || job.done || !isRunning(job.status) || Date.now() >= deadline)
            return;
        await wait(options.pollIntervalMs ?? POLL_INTERVAL_MS);
    }
}
/** The write step. It trusts the pinned plan no further than its hash, and the org for everything else. */
export async function runDeployWrite(adapter, input, pinned, confirmedBriefHash, mode, options = {}) {
    const ctx = contextFor(input, mode);
    const step = options.onStep ?? (() => undefined);
    const gate = gateProblem(ctx, mode);
    if (gate !== null)
        return gate.startsWith('Salesforce') ? { ok: false, reason: gate } : stop(ctx, '', gate);
    const opened = openPinned(pinned.planBytes);
    if ('problem' in opened)
        return stop(ctx, '', opened.problem);
    const { plan, planHash } = opened;
    const unconfirmed = briefProblem(plan, confirmedBriefHash);
    if (unconfirmed !== null)
        return stop(ctx, plan.orgId, unconfirmed);
    if (pinned.expected.cancelDeployId === undefined && planExpired(plan, ctx.now))
        return stop(ctx, plan.orgId, `That plan expired at ${plan.expiresAt}. Write a new plan.`);
    const held = acquireRun(ctx.storeRoot, ctx.projectRoot, plan.id);
    if (held === null)
        return stop(ctx, plan.orgId, 'Another run for this plan is going on this machine, so nothing shipped.');
    try {
        step('identity');
        const live = await writeCheck(adapter, ctx, TOOL, plan.orgId);
        if ('ok' in live)
            return stop(ctx, plan.orgId, reasonOf(live));
        const proven = live.ready;
        const { username } = proven.record;
        if (!effectiveLimits(proven.entry).allowedOperationClasses.includes('write'))
            return stop(ctx, plan.orgId, "This org's limits in orgs.json don't allow a write.");
        const ledger = readLedger(ctx.storeRoot, ctx.projectRoot, plan.id);
        if (pinned.expected.cancelDeployId !== undefined)
            return await runCancel(adapter, ctx, proven, plan, ledger, pinned.expected.cancelDeployId, live.user, options);
        if (ledger.state === 'unreadable')
            return stop(ctx, plan.orgId, 'The ledger for this plan can not be read, so nothing shipped.');
        const prior = ledger.state === 'missing' ? null : ledger.entry;
        if (prior !== null && !prior.refused)
            return stop(ctx, plan.orgId, `A deploy under this plan is ${prior.state}, so nothing was sent again. It is queried, never retried.`);
        step('zip');
        const built = readStoredZip(ctx.storeRoot, ctx.projectRoot, plan.id, plan.artifactHash, pinned.expected.zipHash);
        if ('problem' in built)
            return stop(ctx, plan.orgId, built.problem);
        step('job');
        const validation = readValidation(ctx.storeRoot, ctx.projectRoot, plan.id);
        if (validation === null || validation.jobId !== pinned.expected.validationJobId || validation.zipHash !== pinned.expected.zipHash || validation.planHash !== planHash)
            return stop(ctx, plan.orgId, revalidate('The validation record is not the one the dialog showed.'));
        if ((validation.path === 'dry-run') !== live.facts.isSandbox)
            return stop(ctx, plan.orgId, revalidate('It took the path for a different class of org.'));
        const job = await adapter.deployReport(username, validation.jobId);
        if (isFailure(job))
            return stop(ctx, plan.orgId, revalidate(plainText(job.message, 300)));
        const problems = acceptValidation(job, { userId: live.user.id, members: built.manifest.members, destructive: built.manifest.destructive, ignoreWarnings: plan.ignoreWarnings === true, now: ctx.now });
        if (problems.length > 0)
            return stop(ctx, plan.orgId, revalidate(problems.join(' ')));
        step('drift');
        const current = await adapter.retrieveManifest(username, retrieveManifest(built.manifest));
        if (isFailure(current))
            return stop(ctx, plan.orgId, `The org could not be retrieved to check for drift, so nothing shipped. ${plainText(current.message, 200)}`);
        if (!current.success)
            return stop(ctx, plan.orgId, 'The drift retrieve did not succeed, so nothing shipped.');
        const drift = driftBetween(validation.baseline, baselineOf(current));
        if (drift.length > 0)
            return stop(ctx, plan.orgId, `The org changed since it was validated, so nothing shipped: drift in ${drift.slice(0, 10).map(item => plainText(item, 120)).join(', ')}. A newer change would be overwritten. Write a new plan.`);
        const at = new Date(ctx.now).toISOString();
        const line = { correlationId: plan.id, planId: plan.id, projectRoot: ctx.projectRoot, orgId: plan.orgId, mode: ctx.mode, at };
        try {
            const bytes = snapshotZip(current);
            writeFileAtomic(snapshotFile(ctx.storeRoot, ctx.projectRoot, plan.id), bytes);
            appendJournal(ctx.projectRoot, { ...line, event: 'preimage.saved', hash: sha256(bytes), note: 'The rollback snapshot.' });
        }
        catch (error) {
            return stop(ctx, plan.orgId, `The rollback snapshot could not be saved, so nothing shipped. ${error instanceof Error ? plainText(error.message, 200) : ''}`.trim());
        }
        step('ledger');
        const path = live.facts.isSandbox ? 'start' : 'quick';
        let entry = { version: 1, kind: 'deploy', planId: plan.id, planHash, orgId: plan.orgId, state: 'started', deployId: null, validationJobId: validation.jobId, path, startedAt: at, jobStatus: null, checks: noChecks(), refused: false, failedChecks: [], canceled: false, updatedAt: at };
        try {
            writeLedger(ctx.storeRoot, ctx.projectRoot, entry);
            appendJournal(ctx.projectRoot, { ...line, event: 'change.approved', counts: { rows: built.manifest.members.length + built.manifest.destructive.length }, note: `A person approved plan ${planHash.slice(0, 12)}.` });
            appendJournal(ctx.projectRoot, { ...line, event: 'change.started', note: path });
            acceptAudit(ctx, proven.record, plan.id);
        }
        catch (error) {
            return stop(ctx, plan.orgId, `The ledger could not be written, so nothing was sent. ${error instanceof Error ? plainText(error.message, 200) : ''}`.trim());
        }
        // Past this line, nothing says "nothing shipped" unless the org just said so.
        step('send');
        const sent = path === 'quick' ? await adapter.deployQuick(username, validation.jobId) : await adapter.deployStart(username, zipFile(ctx.storeRoot, ctx.projectRoot, plan.id), { ignoreWarnings: plan.ignoreWarnings === true });
        if (isFailure(sent)) {
            if (sent.failure === 'validation-refused') {
                entry = { ...entry, state: 'partial', refused: true, jobStatus: null, note: plainText(sent.message, 300), updatedAt: at };
                writeLedger(ctx.storeRoot, ctx.projectRoot, entry);
                // That job is spent. Nothing should offer it again, however the org describes it.
                writeJson(validationFile(ctx.storeRoot, ctx.projectRoot, plan.id), { ...validation, state: 'failed', problems: ['Salesforce refused this validation. It has been voided by a later deployment, already used, or expired.'] });
                step('finish');
                return outcomeReport(ctx, proven, plan, { status: 'refused', entry, note: entry.note ?? null }, false);
            }
            entry = { ...entry, state: 'unknown', note: `The deploy may or may not have started, and it is never retried: ${plainText(sent.message, 200)}`, updatedAt: at };
            writeLedger(ctx.storeRoot, ctx.projectRoot, entry);
            step('finish');
            return outcomeReport(ctx, proven, plan, { status: 'unknown', entry, note: entry.note ?? null }, true);
        }
        // On disk before the first poll, so a death from here on can still find the deploy.
        entry = { ...entry, deployId: sent.id, jobStatus: sent.status, updatedAt: at };
        writeLedger(ctx.storeRoot, ctx.projectRoot, entry);
        appendJournal(ctx.projectRoot, { ...line, event: 'change.started', jobId: sent.id, note: path });
        step('sent');
        step('poll');
        await pollDeploy(adapter, username, sent.id, options);
        step('verify');
        const outcome = await settleDeploy({ adapter, ctx, proven, plan, user: live.user, entry });
        step('finish');
        return outcomeReport(ctx, proven, plan, outcome, true);
    }
    finally {
        held.release();
    }
}
/** Done only at Canceled, and followed by a verify. Canceling means it's still going. */
async function runCancel(adapter, ctx, proven, plan, ledger, deployId, user, options) {
    const entry = ledger.state === 'missing' || ledger.state === 'unreadable' ? null : ledger.entry;
    if (entry === null || entry.deployId === null || !sameId(entry.deployId, deployId))
        return stop(ctx, plan.orgId, 'That deploy is no longer the one under this plan, so nothing was canceled.');
    const { username } = proven.record;
    appendJournal(ctx.projectRoot, { event: 'deploy.canceled', correlationId: plan.id, planId: plan.id, jobId: deployId, projectRoot: ctx.projectRoot, orgId: plan.orgId, mode: ctx.mode, at: new Date(ctx.now).toISOString(), status: 'requested', note: 'A person asked to cancel.' });
    const asked = await adapter.deployCancel(username, deployId);
    if (isFailure(asked))
        return outcomeReport(ctx, proven, plan, { status: 'started', entry, note: `The cancel may not have reached the org, so this deploy is not stopped: ${plainText(asked.message, 200)}` }, false);
    await pollDeploy(adapter, username, deployId, options);
    const outcome = await settleDeploy({ adapter, ctx, proven, plan, user, entry });
    return outcomeReport(ctx, proven, plan, outcome, true);
}
