import { charCount, classLabel, escapeExact, hasUnseen, plainText, REDEPLOY_CANNOT_RESTORE, REVERSIBILITY_TEXT, reversibilityOf, VALUE_OUT_MAX, VALUE_SHOWN } from "./contract.js";
import { sha256Hex } from "./digest.js";
import { classifyType, FLAG_ACCESS, FLAG_AUTOMATION, FLAG_CODE, FLAG_UNKNOWN, FLAGS_NONE } from "./metadata-types.js";
/**
 * Contract section 7: what a person reads before a change. Everything above the
 * rule is computed by code from the plan's structure and a fresh live check.
 * `count`, `reversibility`, and any claim a plan makes about itself are not read.
 * The model's text sits below the rule, labelled as unchecked, and can't reach a
 * computed fact. A practice review is not an input, on purpose: it isn't evidence of
 * safety. No Node here: the mod can build this in the hook that asks.
 */
export const MODEL_TEXT_RULE = '────────────────────';
export const MODEL_TEXT_LABEL = "The assistant's description (not checked)";
const MODEL_NOTES_LABEL = "The assistant's notes (not checked)";
const MODEL_TEXT_CAP = 200;
/**
 * The most the dialog is asked to hold. The real limit is recorded by the live checklist. Past this, a change that is
 * still too long once the samples are left out and long values are shortened is refused, and never trimmed any further.
 */
export const SCREEN_LIMIT = 8000;
/** A plan can name 100 fields. One screen cannot show that many values whole, so a plan past this is refused when it is written. */
export const MAX_CHANGED_FIELDS = 12;
const NAME_CAP = 120;
const SAMPLE_COUNT = 3;
/** How many characters of a long new value show when the screen is otherwise too long. Past them it is the length and a hash, as for any cut value. */
const VALUE_SHOWN_TIGHT = 40;
const ROOMY = { samples: SAMPLE_COUNT, shown: VALUE_SHOWN };
/** Samples shrink first: fewer records, then none. Only then do long values get shorter. */
const FITS = [ROOMY, { samples: 2, shown: VALUE_SHOWN }, { samples: 1, shown: VALUE_SHOWN }, { samples: 0, shown: VALUE_SHOWN }, { samples: 0, shown: VALUE_SHOWN_TIGHT }];
/** Counts are always exact. Past this, names are cut, and the line says how many more there are. */
const NAMES_SHOWN = 10;
/** Across the whole screen, so a zip of many types can't push the rest out. Counts stay exact. */
const NAMES_BUDGET = 30;
const TYPE_LINES = 25;
/** Objects that decide who can log in or see data. A write to one is a write to access, whatever the field. */
const ACCESS_OBJECTS = new Set(['user', 'permissionsetassignment', 'permissionset', 'permissionsetgroup', 'permissionsetgroupcomponent', 'permissionsetlicenseassign', 'group', 'groupmember', 'queuesobject', 'userrole', 'userterritory', 'user_territory2association', 'profile', 'setupentityaccess', 'objectpermissions', 'fieldpermissions', 'userpackagelicense', 'userlicense', 'packagelicense', 'connectedapplication', 'oauthtoken', 'loginip', 'networkmember', 'delegategroup', 'collaborationgroupmember', 'customobjectuseralias', 'authconfig', 'namedcredential', 'externaldatasource']);
function isAccessObject(object) {
    const lowered = object.toLowerCase();
    return ACCESS_OBJECTS.has(lowered) || /share$/.test(lowered);
}
function count(value) {
    return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function name(value) {
    return plainText(value, NAME_CAP);
}
/** The whole value in quotes, with every hidden character written out. A cut value says so, how long it is, and holds a hash of the whole. */
function quoted(value, counted, limit = VALUE_SHOWN) {
    const length = charCount(value);
    let out = escapeExact(value, limit, VALUE_OUT_MAX);
    // A shorter cut may not hide a character nobody can see. Plan time checked the usual cut, so that is where it falls back to.
    if (limit < VALUE_SHOWN && out.covered < length && hasUnseen(Array.from(value).slice(out.covered).join('')))
        out = escapeExact(value, VALUE_SHOWN, VALUE_OUT_MAX);
    if (out.covered >= length)
        return `"${out.text}"${counted ? ` (${count(length)} ${length === 1 ? 'character' : 'characters'})` : ''}`;
    return `"${out.text}…" (cut: the first ${count(out.covered)} of ${count(length)} characters show. SHA-256 of the whole value: ${sha256Hex(value).slice(0, 16)}…)`;
}
/** A string is always in quotes, so null (which clears a field) and the text null can't look alike. */
function shown(value, counted = false, limit = VALUE_SHOWN) {
    if (value === null || value === undefined)
        return 'null';
    if (typeof value === 'string')
        return quoted(value, counted, limit);
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    return quoted(JSON.stringify(value) ?? 'null', counted, limit);
}
/** Names that came from a zip or an org: quoted, so one can't read as a sentence, with hidden characters written out. */
function quotedName(value) {
    const out = escapeExact(value, NAME_CAP, NAME_CAP * 3);
    return `"${out.text}${out.covered < charCount(value) ? '…' : ''}"`;
}
/** The label is built from a template, so nothing a plan holds can turn it into the wording used for lesser things. */
function objectForLabel(object) {
    const clean = object.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
    if (clean.length === 0)
        return 'object';
    return clean.replace(/[^A-Za-z]/g, '').toLowerCase().includes('okaytocontinue') ? 'object' : clean;
}
function classOf(identity) {
    return classLabel(identity.isSandbox ? 'sandbox' : 'production');
}
function identityLines(identity) {
    return [`Class: ${classOf(identity)}`, `Org: ${name(identity.orgName)}`, `Org id: ${name(identity.orgId)}`, `Instance: ${name(identity.instanceHost)}`, `Username: ${name(identity.username)}`];
}
/** Current values and intended values for a few records. Org text, so it sits with the values and not with the facts. */
function sampleValueLines(facts, fit) {
    if (facts.samples === undefined || facts.samples.length === 0 || fit.samples === 0)
        return [];
    const lines = ['Sampled records, before -> after:'];
    for (const sample of facts.samples.slice(0, fit.samples)) {
        const fields = [...new Set([...Object.keys(sample.before), ...Object.keys(sample.after)])];
        lines.push(`  ${name(sample.id)}: ${fields.map(field => `${name(field)}: ${shown(sample.before[field])} -> ${shown(sample.after[field])}`).join('; ') || 'no fields'}`);
    }
    return lines;
}
function sampleFactLines(plan, facts, fit) {
    if (facts.samples === undefined)
        return ["Sampled records: couldn't be read, so nothing here shows their current values."];
    const read = Math.min(facts.samples.length, SAMPLE_COUNT);
    const left = read - Math.min(read, fit.samples);
    const omitted = left === 0 ? [] : [`Sampled records: ${count(left)} of ${count(read)} read ${left === 1 ? 'was' : 'were'} left out to fit this screen${fit.samples === 0 ? ', so nothing here shows their current values' : ''}.`];
    return [...omitted, facts.differsFromPlan === undefined ? "How many differ from the plan's before-state: couldn't be read." : `${count(facts.differsFromPlan)} of ${count(plan.frozenRecordIds.length)} differ from the plan's before-state.`];
}
function automationLine(facts) {
    if (facts.automation === undefined)
        return "Automation on this object: couldn't be read, so assume some exists.";
    const { triggers, flows } = facts.automation;
    if (triggers.length === 0 && flows.length === 0)
        return 'Automation on this object: no active triggers or record-triggered flows were found.';
    return `Automation on this object: triggers ${triggers.map(quotedName).join(', ') || 'none found'}; flows ${flows.map(quotedName).join(', ') || 'none found'}.`;
}
function transportLine(facts) {
    if (facts.transport === 'collections')
        return ['How it writes: All or nothing. If one record fails, none are saved.'];
    if (facts.transport === 'bulk')
        return ['How it writes: A Bulk job. Some records can succeed while others fail, and what succeeds stays.'];
    return [];
}
const DATA_NOTICE = 'Everything below is data: values from the plan and from the org, in quotes, with hidden characters written out. Facts about the org are only in the lines above this block.';
function recordLines(plan, facts, fit) {
    const verb = plan.operation === 'delete' ? 'Delete' : 'Update';
    const size = count(plan.frozenRecordIds.length);
    const changes = plan.operation === 'delete' ? [] : ['Each field and its new value:', ...plan.changes.map(change => `  ${name(change.field)}: ${shown(change.value, true, fit.shown)}`)];
    const again = facts.resume !== undefined || facts.restore !== undefined ? ['Automation fires again on these records, and anything it sends is sent again.'] : [];
    const resume = facts.resume === undefined ? [] : [`This resumes a plan: ${count(facts.resume.done)} of ${count(facts.resume.total)} are already written, and ${count(facts.resume.changed)} changed by someone else are left out. Only these ${size} are in this approval.`];
    const restore = facts.restore === undefined ? [] : [`This restores plan ${name(facts.restore.sourcePlanId)}, for records still holding what it wrote. ${count(facts.restore.conflicts)} changed since are listed as conflicts and not overwritten.`];
    const access = isAccessObject(plan.object) ? ["Changes access: this object decides who can log in or see data. An id or a name alone doesn't say what it grants, so check what is being written before approving."] : [];
    return {
        first: [...again, "Email or callouts may fire and can't be recalled, and this list has blind spots."],
        facts: [`Operation: ${verb}`, `Object: ${name(plan.object)}`, `Exact count: ${size}`, ...access, automationLine(facts), ...transportLine(facts), ...resume, ...restore, ...sampleFactLines(plan, facts, fit)],
        values: [...changes, ...sampleValueLines(facts, fit)],
        label: place => `${verb} ${size} ${objectForLabel(plan.object)} in ${place}`,
    };
}
function age(ms) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    if (hours >= 48)
        return `${Math.floor(hours / 24)} days`;
    if (hours >= 1)
        return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    return `${Math.floor(ms / 60_000)} minutes`;
}
function typeNames(types) {
    const list = [...new Set(types)];
    return `${list.slice(0, 6).map(quotedName).join(', ')}${list.length > 6 ? `, and ${count(list.length - 6)} more` : ''}`;
}
/** From the table, and with no default of "fine": an unknown type is flagged. */
function deployFlags(plan, parts, facts) {
    const touched = parts.filter(part => part.added.length + part.changed.length + part.deleted.length > 0);
    const of = (kind) => touched.filter(part => classifyType(part.type) === kind).map(part => part.type);
    const flags = [];
    if (of('code').length > 0)
        flags.push(`${FLAG_CODE} (${typeNames(of('code'))})`);
    if (of('access').length > 0)
        flags.push(`${FLAG_ACCESS} (${typeNames(of('access'))})`);
    if (of('automation').length > 0)
        flags.push(`${FLAG_AUTOMATION} (${typeNames(of('automation'))})`);
    if (of('unknown').length > 0)
        flags.push(`${FLAG_UNKNOWN} (${typeNames(of('unknown'))})`);
    if (plan.destructive || parts.some(part => part.deleted.length > 0))
        flags.push('Deletes.');
    if (facts.ignoreWarnings === true)
        flags.push('Ignores warnings, as the plan names.');
    return flags;
}
/** Flagged types first, then the rest while there is room. A type left out of the list is still in the counts and the flags. */
function componentLines(parts) {
    const rank = (part) => (classifyType(part.type) === 'benign' ? 1 : 0);
    const ordered = [...parts].sort((left, right) => rank(left) - rank(right));
    let namesLeft = NAMES_BUDGET;
    const lines = [];
    let omitted = { types: 0, added: 0, changed: 0, deleted: 0 };
    for (const part of ordered) {
        if (rank(part) === 1 && lines.length >= TYPE_LINES) {
            omitted = { types: omitted.types + 1, added: omitted.added + part.added.length, changed: omitted.changed + part.changed.length, deleted: omitted.deleted + part.deleted.length };
            continue;
        }
        lines.push(`  ${quotedName(part.type)}: ${count(part.added.length)} added, ${count(part.changed.length)} changed, ${count(part.deleted.length)} deleted`);
        for (const [word, list] of [['Added', part.added], ['Changed', part.changed], ['Deleted', part.deleted]]) {
            if (list.length === 0 || namesLeft <= 0)
                continue;
            const take = Math.min(list.length, NAMES_SHOWN, namesLeft);
            namesLeft -= take;
            lines.push(`    ${word}: ${list.slice(0, take).map(quotedName).join(', ')}${list.length > take ? `, and ${count(list.length - take)} more not listed` : ''}`);
        }
    }
    if (omitted.types > 0)
        lines.push(`  ${count(omitted.types)} more known-benign types, not listed: ${count(omitted.added)} added, ${count(omitted.changed)} changed, ${count(omitted.deleted)} deleted`);
    return lines;
}
function deployLines(plan, facts) {
    const first = [`What a redeploy can't restore: ${REDEPLOY_CANNOT_RESTORE.join(', ')}.`, ...(facts.rollbackOf !== undefined ? [`This puts back the rollback snapshot taken before plan ${name(facts.rollbackOf)}, as a new change. Components that plan added stay.`] : [])];
    const parts = facts.components;
    if (parts === undefined) {
        return {
            first,
            facts: ["Components: the zip couldn't be read, so nothing here shows what ships. Treat it as able to run code, change access, or open an outbound path.", ...(plan.destructive ? ['Flags: Deletes.'] : []), ...jobLines(facts)],
            values: [],
            label: place => `Deploy components to ${place}`,
        };
    }
    const flags = deployFlags(plan, parts, facts);
    const total = parts.reduce((sum, part) => sum + part.added.length + part.changed.length + part.deleted.length, 0);
    return {
        first,
        facts: [`Flags: ${flags.join(' ') || FLAGS_NONE}`, "Components, read from the zip (type and member names are the zip's own text, in quotes):", ...componentLines(parts), ...jobLines(facts)],
        values: [],
        label: place => `Deploy ${count(total)} ${total === 1 ? 'component' : 'components'} to ${place}`,
    };
}
function cancelLines(plan) {
    return {
        first: ["A deploy that has started committing can't be stopped, and parts of it may already have been committed. The org is read again afterward."],
        facts: ['Operation: Cancel a running deploy', `Job id: ${name(plan.deployId)}`],
        values: [],
        label: place => `Cancel deploy in ${place}`,
    };
}
function testLines(plan) {
    return {
        first: ["This runs code in the org. Test data rolls back when a test ends, and what a test sends or calls outside the org isn't covered by that."],
        facts: ['Operation: Run Apex tests', `Test level: ${name(plan.level)}`, ...(plan.classNames.length > 0 ? [`Classes: ${plan.classNames.map(quotedName).join(', ')}`] : [])],
        values: [],
        label: place => `Run Apex tests in ${place}`,
    };
}
function validateLines(plan, facts) {
    const parts = facts.components ?? [];
    const flags = deployFlags({ kind: 'deploy', destructive: plan.destructive, planHash: plan.planHash, expiresAt: plan.expiresAt, businessObjective: '', notes: '' }, parts, facts);
    return {
        first: ["This runs code in the org: every local test, and the Apex this zip holds. Test data rolls back when a test ends, and what a test sends or calls outside the org isn't covered by that. The assistant is told how many tests failed. Nothing ships."],
        facts: [
            'Operation: Validate a deploy (check only, nothing ships)',
            `Apex in this zip: ${plan.apex.length === 0 ? 'none' : plan.apex.map(quotedName).join(', ')}`,
            `Flags: ${flags.join(' ') || FLAGS_NONE}`,
            ...(facts.components === undefined ? [] : ["Components, read from the zip (type and member names are the zip's own text, in quotes):", ...componentLines(parts)]),
            `Test level: ${name(facts.testLevel ?? 'not known')}`,
        ],
        values: [],
        label: place => `Run Apex and tests in ${place}`,
    };
}
function jobLines(facts) {
    return [`Validated with test level: ${name(facts.testLevel ?? 'not known')}`, `Job id: ${name(facts.jobId ?? 'not known')}`, `Job age: ${facts.jobAgeMs === undefined ? 'not known' : age(facts.jobAgeMs)}`];
}
/**
 * The screen at the roomiest fit that holds. The identity, the count, every field and every value are in every fit.
 * What goes first is the sampled records (fewer, then none, and the screen says so), and after that long values
 * are cut to the start, the length and a hash. Only a change whose facts still don't fit is refused.
 */
export function buildApprovalScreen(plan, facts) {
    if (plan.kind !== 'records')
        return screenAt(plan, facts, ROOMY);
    let screen = screenAt(plan, facts, ROOMY);
    for (const fit of FITS.slice(1)) {
        if (screen.text.length <= SCREEN_LIMIT)
            break;
        screen = screenAt(plan, facts, fit);
    }
    return screen;
}
function screenAt(plan, facts, fit) {
    const { identity } = facts;
    const place = classOf(identity);
    const kind = plan.kind === 'records' ? recordLines(plan, facts, fit) : plan.kind === 'cancel' ? cancelLines(plan) : plan.kind === 'tests' ? testLines(plan) : plan.kind === 'validate' ? validateLines(plan, facts) : deployLines(plan, facts);
    const reversibility = plan.kind === 'records' ? reversibilityOf({ kind: 'records', operation: plan.operation }) : reversibilityOf({ kind: 'deploy' });
    const reversibilityLine = plan.kind === 'tests' || plan.kind === 'validate' ? [] : [`Reversibility: ${reversibility}. ${REVERSIBILITY_TEXT[reversibility]}`];
    const approveLabel = plainText(kind.label(place), 80);
    const requiresTypedOrgName = !identity.isSandbox;
    const typedOrgName = requiresTypedOrgName ? plainText(identity.orgName, 80) : null;
    // Stop comes first in every dialog, so a stray Enter can't approve.
    const options = requiresTypedOrgName ? ['Stop', 'Not this change'] : ['Stop', approveLabel];
    const objective = plainText(plan.businessObjective, MODEL_TEXT_CAP);
    const notes = plainText(plan.notes, MODEL_TEXT_CAP);
    // Facts first, all of them computed and short. Values come after, because they are the part that can be long.
    const lines = [
        ...(facts.auditUnchecked !== undefined ? [`Couldn't check: ${plainText(facts.auditUnchecked, 400)} So a change made outside Topia wouldn't show here. You decide.`, ''] : []),
        "What can't be undone:",
        ...kind.first,
        ...reversibilityLine,
        '',
        ...identityLines(identity),
        '',
        ...kind.facts,
        ...(facts.audit !== undefined ? [`Audit trail: ${plainText(facts.audit, 400)}`] : []),
        '',
        `Plan hash: ${plan.planHash.slice(0, 12)}`,
        `Expires: ${plainText(plan.expiresAt, 40)}`,
        ...(requiresTypedOrgName ? [`This is production. To approve, choose Other and type the org name exactly: ${typedOrgName}`] : []),
        ...(kind.values.length > 0 ? ['', DATA_NOTICE, ...kind.values] : []),
        MODEL_TEXT_RULE,
        `${MODEL_TEXT_LABEL}: ${objective || 'none'}`,
        ...(notes.length > 0 ? [`${MODEL_NOTES_LABEL}: ${notes}`] : []),
        '',
        requiresTypedOrgName ? `Approve this act: ${approveLabel}?` : 'Approve this exact change?',
    ];
    const text = lines.join('\n');
    const refusal = text.length > SCREEN_LIMIT ? `This change is too long to show whole, even with the sampled records left out and long values cut to their start, length and hash (${count(text.length)} characters, and the most shown is ${count(SCREEN_LIMIT)}), so it can't be approved. Split it into smaller plans.` : null;
    return { text, approveLabel, requiresTypedOrgName, typedOrgName, options, refusal };
}
/** Exact, always. The Other box returns free text, so nothing close counts, and a button can't stand in for the typed name. */
export function approvalAccepted(screen, answer) {
    if (screen.refusal !== null)
        return false;
    if (screen.requiresTypedOrgName)
        return screen.typedOrgName !== null && screen.typedOrgName.length > 0 && answer === screen.typedOrgName && !screen.options.includes(answer);
    return answer === screen.approveLabel;
}
