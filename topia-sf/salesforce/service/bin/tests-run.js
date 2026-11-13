import { lockState } from './activation.js';
import { isFailure } from './adapter.js';
import { readBrief } from './brief.js';
import { plainText } from './contract.js';
import { appendJournal } from './journal.js';
import { writeRunLog } from './log-retention.js';
import { modeAllowsTool, toolRefusal } from './modes.js';
import { logDirectory } from './paths.js';
import { canonical, sha256 } from './plans.js';
import { effectiveLimits } from './registry.js';
import { resultOf } from './records-write.js';
import { TESTS_RUN_SCHEMA, validateArgs } from './tool-schemas.js';
import { liveCheck, preferWriter, writeCheck } from './tools.js';
/**
 * Contract section 2. Tests run code in the org, so a person approves a run, from a
 * closed argv. It's async: starting returns a run id, and reading the result is a
 * read, with no dialog. Results go to the project's 30-day log.
 */
const TOOL = 'sf_tests_run';
function stop(reason) {
    return { ok: false, reason };
}
function reasonOf(result) {
    const message = result.data?.message;
    return result.notice ?? (typeof message === 'string' ? message : 'That could not be checked, so nothing ran.');
}
function journaled(ctx, reason) {
    try {
        appendJournal(ctx.projectRoot, { event: 'refusal', correlationId: ctx.correlationId, projectRoot: ctx.projectRoot, orgId: '', mode: ctx.mode, at: new Date(ctx.now).toISOString(), note: reason });
    }
    catch {
        // A refusal stands whether or not the journal could take it.
    }
    return reason;
}
function gateProblem(ctx, mode, briefId, confirmedBriefHash) {
    const lock = lockState(ctx.storeRoot, ctx.projectRoot);
    if (lock.state === 'off')
        return 'Salesforce is not on for this project. /topia-sf:enable turns it on.';
    if (lock.state === 'unreadable')
        return lock.message;
    if (!modeAllowsTool(mode, TOOL))
        return journaled(ctx, `${TOOL} does not run in ${mode} mode. ${toolRefusal(TOOL, null) ?? ''}`.trim());
    const brief = typeof briefId === 'string' ? readBrief(ctx.storeRoot, ctx.projectRoot, briefId) : null;
    if (brief === null || confirmedBriefHash === null || brief.briefHash !== confirmedBriefHash)
        return journaled(ctx, 'A test run needs a brief a person has confirmed this session. Call sf_brief_confirm first. A chat reply is not confirmation.');
    return null;
}
function hashOf(pinned) {
    return sha256(canonical(pinned));
}
export async function prepareTestsRun(adapter, input, request, confirmedBriefHash, mode) {
    const ctx = { ...input, mode, stamp: null, brief: null };
    try {
        const problem = validateArgs(TESTS_RUN_SCHEMA, request, 'sf_tests_run');
        if (problem !== null)
            return stop(problem);
        const gate = gateProblem(ctx, mode, request.briefId, confirmedBriefHash);
        if (gate !== null)
            return stop(gate);
        const orgId = request.orgId;
        // Starting a run runs code in the org. Reading one back is a read.
        const live = typeof request.runId === 'string' ? await liveCheck(adapter, ctx, TOOL, orgId, (await preferWriter(adapter, ctx, orgId)).as) : await writeCheck(adapter, ctx, TOOL, orgId);
        if ('ok' in live)
            return stop(reasonOf(live));
        const proven = live.ready;
        if (!effectiveLimits(proven.entry).allowedOperationClasses.includes('validate'))
            return stop("This org's limits in orgs.json don't allow a test run.");
        if (typeof request.runId === 'string') {
            const got = await adapter.apexGet(proven.record.username, request.runId);
            if (isFailure(got))
                return stop(`The test run could not be read. ${plainText(got.message, 300)}`);
            if (got.kind !== 'finished')
                return stop('The test run came back in a shape this version does not recognize, so its result is unknown.');
            const data = {
                runId: request.runId,
                outcome: got.outcome,
                testsRan: got.testsRan,
                passing: got.passing,
                failing: got.failing,
                skipped: got.skipped,
                orgWideCoverage: got.orgWideCoverage,
                testRunCoverage: got.testRunCoverage,
                // Names only. A failure message can quote the records a test read, and nobody saw a query for them.
                failed: got.failed.slice(0, 50).map(item => ({ name: plainText(item.name, 200) })),
                failureMessagesWithheld: got.failed.length > 0 ? 'Messages and stack traces are not returned: a test can put record data in them. A person reads them in Setup, under Apex Test Execution.' : undefined,
                notProven: ['Tests see no real data unless they use SeeAllData.', 'Coverage without assertions proves nothing.', 'These are Apex tests. Flow tests are separate.'],
                next: ['Queued', 'Processing', 'Preparing'].includes(got.outcome) ? 'It is still running. Call this again with the same runId.' : 'A test run is not a deploy, and a fix is a new plan.',
            };
            writeRunLog(logDirectory(ctx.storeRoot, ctx.projectRoot, 'sf-test-runs'), { command: `apex get test ${request.runId}`, result: JSON.stringify(data), durationMs: 0, correlationId: ctx.correlationId }, `${request.runId}.log`);
            return resultOf(ctx, TOOL, proven, data, false);
        }
        const level = (typeof request.level === 'string' ? request.level : 'RunLocalTests');
        const classNames = Array.isArray(request.classNames) ? request.classNames : [];
        if (level === 'RunSpecifiedTests' && classNames.length === 0)
            return stop('RunSpecifiedTests names at least one class.');
        if (level !== 'RunSpecifiedTests' && classNames.length > 0)
            return stop('Only RunSpecifiedTests names classes.');
        const body = { orgId, briefId: request.briefId, level, classNames };
        const hash = hashOf(body);
        return {
            ok: true,
            action: 'approve',
            screenPlan: { kind: 'tests', level, classNames, planHash: hash, expiresAt: 'when this dialog closes', businessObjective: '', notes: '' },
            facts: { identity: live.facts, testLevel: level },
            pinned: { ...body, hash },
        };
    }
    catch (error) {
        return stop(error instanceof Error ? `The test run could not be prepared, so nothing ran. ${plainText(error.message, 300)}` : 'The test run could not be prepared, so nothing ran.');
    }
}
export async function runTestsRun(adapter, input, pinned, confirmedBriefHash, mode) {
    const ctx = { ...input, mode, stamp: null, brief: null };
    try {
        const gate = gateProblem(ctx, mode, pinned.briefId, confirmedBriefHash);
        if (gate !== null)
            return stop(gate);
        const { hash, ...body } = pinned;
        if (hashOf(body) !== hash)
            return stop('The test run is not the one the dialog showed, so nothing ran.');
        const live = await writeCheck(adapter, ctx, TOOL, pinned.orgId);
        if ('ok' in live)
            return stop(reasonOf(live));
        const proven = live.ready;
        const started = await adapter.apexRun(proven.record.username, pinned.level, pinned.classNames);
        if (isFailure(started) || started.kind !== 'started') {
            const note = isFailure(started) ? plainText(started.message, 300) : 'The CLI waited for the run, which this never asks for.';
            return resultOf(ctx, TOOL, proven, { status: 'unknown', note: `A run may or may not have started: ${note}`, next: 'It is not retried. The Apex Test Execution page in Setup shows what ran.' }, true);
        }
        appendJournal(ctx.projectRoot, { event: 'tests.started', correlationId: ctx.correlationId, jobId: started.runId, projectRoot: ctx.projectRoot, orgId: proven.record.orgId, mode: ctx.mode, at: new Date(ctx.now).toISOString(), status: 'started', note: `Level ${pinned.level}, ${pinned.classNames.length} classes named.` });
        return resultOf(ctx, TOOL, proven, { status: 'started', runId: started.runId, next: 'Started, and it runs in the org. Call sf_tests_run with this runId to read the result. That is a read, so no dialog opens.' }, true);
    }
    catch (error) {
        return stop(error instanceof Error ? `The test run could not start. ${plainText(error.message, 300)}` : 'The test run could not start.');
    }
}
