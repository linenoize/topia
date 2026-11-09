import { lockState } from './activation.js';
import { plainText } from './contract.js';
import { apexIn, deploymentValidate, readValidation } from './deploy.js';
import { buildZip, componentSummary } from './deploy-zip.js';
import { appendJournal } from './journal.js';
import { modeAllowsTool, toolRefusal } from './modes.js';
import { loadPlan } from './plan-tools.js';
import { effectiveLimits } from './registry.js';
import { formatToolText, writeCheck } from './tools.js';
import { VALIDATE_RUN_SCHEMA, validateArgs } from './tool-schemas.js';
/**
 * Review H3. A zip that holds Apex runs model-written code in the org when it is
 * validated, along with every local test, and the result comes back to the assistant.
 * Over stdio nobody approves that, so deployment_validate refuses such a zip. This is the
 * way for it to run: a person sees what the zip holds and answers a dialog first. Picking
 * up a validation already started reads, and opens no dialog.
 */
const TOOL = 'sf_deployment_validate';
const LEVEL = 'RunLocalTests';
function stop(ctx, reason) {
    try {
        appendJournal(ctx.projectRoot, { event: 'refusal', correlationId: ctx.correlationId, projectRoot: ctx.projectRoot, orgId: '', mode: ctx.mode, at: new Date(ctx.now).toISOString(), note: reason });
    }
    catch {
        // A refusal stands whether or not the journal could take it.
    }
    return { ok: false, reason };
}
function gateProblem(ctx, mode, planBriefHash, confirmedBriefHash) {
    const lock = lockState(ctx.storeRoot, ctx.projectRoot);
    if (lock.state === 'off')
        return 'Salesforce is not on for this project. /topia:sf:enable turns it on.';
    if (lock.state === 'unreadable')
        return lock.message;
    if (!modeAllowsTool(mode, TOOL))
        return `${TOOL} does not run in ${mode} mode. ${toolRefusal(TOOL, null) ?? ''}`.trim();
    if (planBriefHash !== null && (confirmedBriefHash === null || planBriefHash !== confirmedBriefHash))
        return 'This plan needs a brief a person has confirmed this session. Call sf_brief_confirm first. A chat reply is not confirmation.';
    return null;
}
function reportOf(result, wrote) {
    const data = result.data !== null && typeof result.data === 'object' ? result.data : { message: plainText(String(result.data ?? ''), 300) };
    return { ok: true, action: 'report', text: formatToolText({ ...result, sideEffect: wrote }), data, wrote };
}
function contextOf(input, mode) {
    return { ...input, mode, stamp: null, brief: null, apexApproved: true };
}
export async function prepareValidate(adapter, input, request, confirmedBriefHash, mode) {
    const ctx = contextOf(input, mode);
    try {
        const problem = validateArgs(VALIDATE_RUN_SCHEMA, request, TOOL);
        if (problem !== null)
            return stop(ctx, problem);
        const planId = request.planId;
        const loaded = loadPlan(ctx.storeRoot, ctx.projectRoot, planId, ctx.now);
        if (!loaded.ok)
            return stop(ctx, loaded.reason);
        if (loaded.plan.kind !== 'deploy')
            return stop(ctx, 'That plan is not a deploy plan.');
        const plan = loaded.plan;
        const gate = gateProblem(ctx, mode, plan.briefHash, confirmedBriefHash);
        if (gate !== null)
            return gate.startsWith('Salesforce') ? { ok: false, reason: gate } : stop(ctx, gate);
        const live = await writeCheck(adapter, ctx, TOOL, plan.orgId);
        if ('ok' in live)
            return stop(ctx, live.notice ?? 'That could not be checked, so nothing ran.');
        const proven = live.ready;
        if (!effectiveLimits(proven.entry).allowedOperationClasses.includes('validate'))
            return stop(ctx, "This org's limits in orgs.json don't allow validate.");
        const revalidate = request.revalidate === true;
        // Reading a validation already started starts nothing, so it needs no dialog.
        const held = readValidation(ctx.storeRoot, ctx.projectRoot, plan.id);
        if (held !== null && !revalidate && held.planHash === loaded.planHash) {
            return reportOf(await deploymentValidate(adapter, { orgId: plan.orgId, planId: plan.id }, ctx), false);
        }
        const built = buildZip(ctx.storeRoot, ctx.projectRoot, loaded.values.artifactPath ?? '', plan.artifactHash);
        if ('problem' in built)
            return stop(ctx, built.problem);
        const apex = apexIn(built.manifest).map(member => member.replace(':', ' '));
        return {
            ok: true,
            action: 'approve',
            screenPlan: { kind: 'validate', destructive: plan.destructive, apex, planHash: loaded.planHash, expiresAt: plan.expiresAt, businessObjective: loaded.values.businessObjective, notes: loaded.values.notes },
            facts: { identity: live.facts, components: componentSummary(built.manifest, []), testLevel: LEVEL },
            pinned: { planId: plan.id, planHash: loaded.planHash, orgId: plan.orgId, revalidate },
        };
    }
    catch (error) {
        return stop(ctx, error instanceof Error ? `The validation could not be prepared, so nothing ran. ${plainText(error.message, 300)}` : 'The validation could not be prepared, so nothing ran.');
    }
}
export async function runValidate(adapter, input, pinned, confirmedBriefHash, mode) {
    const ctx = contextOf(input, mode);
    try {
        const loaded = loadPlan(ctx.storeRoot, ctx.projectRoot, pinned.planId, ctx.now);
        if (!loaded.ok)
            return stop(ctx, loaded.reason);
        if (loaded.plan.kind !== 'deploy')
            return stop(ctx, 'That plan is not a deploy plan.');
        const gate = gateProblem(ctx, mode, loaded.plan.briefHash, confirmedBriefHash);
        if (gate !== null)
            return stop(ctx, gate);
        // The plan hash covers the artifact hash, so the zip is the one the dialog described.
        if (loaded.planHash !== pinned.planHash)
            return stop(ctx, 'The plan is not the one the dialog showed, so nothing ran.');
        const result = await deploymentValidate(adapter, { orgId: loaded.plan.orgId, planId: pinned.planId, revalidate: pinned.revalidate }, ctx);
        return reportOf(result, true);
    }
    catch (error) {
        return stop(ctx, error instanceof Error ? `The validation could not run. ${plainText(error.message, 300)}` : 'The validation could not run.');
    }
}
