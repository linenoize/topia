import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isFailure } from './adapter.js';
import { redactSecrets, redactXml } from './redact.js';
import { DEFAULT_TIMEOUT_MS, makePrivateDir, prepareDeployWorkspace, removePrivateDir, resolveCli, runSf, writeTempProject } from './sf-cli.js';
import { failure, parseApexRun, parseBulkJob, parseBulkResults, parseBulkStart, parseCollections, parseDeployRun, parseDescribe, parseOrganization, parseOrgDisplay, parseQueryResult, parseRetrieve, parseUser, readApiAnswer, readEnvelope } from './sf-parse.js';
import { escapeSoqlString } from './soql.js';
export const ORGANIZATION_SOQL = 'SELECT Id, Name, IsSandbox, OrganizationType, InstanceName FROM Organization';
const RETRIEVE_TIMEOUT_MS = 6 * 60 * 1000;
const MAX_READ_BYTES = 512 * 1024;
// The same ceiling an artifact has (deploy-zip.ts). Past it a retrieve fails: a list cut short would read as no drift.
const MAX_FILES = 20_000;
const ZIP_NAME = 'retrieved.zip';
const WRITE_TIMEOUT_MS = 5 * 60 * 1000;
const API_VERSION = 'v66.0';
/** The real adapter: every read is one spawn of the Salesforce CLI, resolved once and targeted by username. */
export class SfCliAdapter {
    options;
    resolved = null;
    constructor(options) {
        this.options = options;
    }
    cli() {
        if (this.resolved === null) {
            this.resolved = resolveCli({ env: this.options.env, projectRoot: this.options.projectRoot, versionTimeoutMs: this.options.versionTimeoutMs });
        }
        return this.resolved;
    }
    async run(call, extra = {}) {
        const cli = await this.cli();
        if ('error' in cli)
            return failure('cli-missing', cli.message);
        try {
            return await runSf(cli, call, { env: this.options.env, timeoutMs: this.options.timeoutMs, ...extra });
        }
        catch (error) {
            // argsFor refuses a value it will not pass on. That is a refusal, not a CLI result.
            return failure('denied', error instanceof Error ? error.message : 'That call was refused.');
        }
    }
    async display(target) {
        const run = await this.run({ kind: 'org.display', target });
        if (isFailure(run))
            return run;
        const envelope = readEnvelope(run);
        return isFailure(envelope) ? envelope : parseOrgDisplay(envelope);
    }
    async query(username, soql, options = {}) {
        const run = await this.run({ kind: 'data.query', target: username, file: 'query.soql', tooling: options.tooling, allRows: options.allRows }, { soql });
        if (isFailure(run))
            return run;
        const envelope = readEnvelope(run);
        return isFailure(envelope) ? envelope : parseQueryResult(envelope);
    }
    async count(username, soql) {
        const run = await this.run({ kind: 'data.query', target: username, file: 'query.soql' }, { soql });
        if (isFailure(run))
            return run;
        const envelope = readEnvelope(run);
        if (isFailure(envelope))
            return envelope;
        const rows = parseQueryResult(envelope, { isCount: true });
        return isFailure(rows) ? rows : { count: rows.totalSize };
    }
    async liveOrg(username) {
        const rows = await this.query(username, ORGANIZATION_SOQL);
        return isFailure(rows) ? rows : parseOrganization(rows);
    }
    async liveUser(username) {
        const rows = await this.query(username, `SELECT Id, Username, Name, IsActive, Profile.Name FROM User WHERE Username = '${escapeSoqlString(username)}'`);
        return isFailure(rows) ? rows : parseUser(rows);
    }
    /** Any failure here is `unknown`, and the band warns on unknown. It never reads as read-only. */
    async writeAccess(username, userId) {
        const id = escapeSoqlString(userId);
        const held = await this.query(username, `SELECT PermissionSet.PermissionsModifyAllData, PermissionSet.PermissionsModifyMetadata, PermissionSet.PermissionsCustomizeApplication, PermissionSet.PermissionsAuthorApex FROM PermissionSetAssignment WHERE AssigneeId = '${id}'`);
        if (isFailure(held))
            return { canWrite: 'unknown', reasons: [held.message] };
        if (held.truncated)
            return { canWrite: 'unknown', reasons: ['The permission list came back incomplete.'] };
        // Every user holds at least a profile's permission set, so an empty list is a read that went wrong.
        if (held.records.length === 0)
            return { canWrite: 'unknown', reasons: ['The permission list came back empty, which no real user has.'] };
        const reasons = new Set();
        const NAMES = {
            PermissionsModifyAllData: 'Modify All Data',
            PermissionsModifyMetadata: 'Modify Metadata',
            PermissionsCustomizeApplication: 'Customize Application',
            PermissionsAuthorApex: 'Author Apex',
        };
        for (const record of held.records) {
            const set = record.PermissionSet;
            if (set === null || typeof set !== 'object')
                return { canWrite: 'unknown', reasons: ['The permission list came back in an unexpected shape.'] };
            for (const [field, label] of Object.entries(NAMES))
                if (set[field] === true)
                    reasons.add(label);
        }
        const objects = await this.query(username, `SELECT SobjectType FROM ObjectPermissions WHERE ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${id}') AND (PermissionsCreate = true OR PermissionsEdit = true OR PermissionsDelete = true) LIMIT 1`);
        if (isFailure(objects))
            return { canWrite: 'unknown', reasons: [objects.message] };
        if (objects.records.length > 0)
            reasons.add('Create, edit, or delete on at least one object');
        return { canWrite: reasons.size > 0 ? 'yes' : 'no', reasons: [...reasons] };
    }
    async describe(username, object) {
        const run = await this.run({ kind: 'sobject.describe', target: username, sobject: object });
        if (isFailure(run))
            return run;
        const envelope = readEnvelope(run);
        return isFailure(envelope) ? envelope : parseDescribe(envelope);
    }
    async apiGet(username, path) {
        const run = await this.run({ kind: 'api.get', target: username, path });
        return isFailure(run) ? run : readApiAnswer(run);
    }
    /**
     * One request. It carries no retry, and neither does anything above it. A timeout
     * or a killed CLI comes back as unknown, because the request may still land.
     */
    async collectionsUpdate(username, body, ids) {
        const run = await this.run({ kind: 'records.collections', target: username, bodyFile: 'body.json' }, { payload: body, timeoutMs: this.options.writeTimeoutMs ?? WRITE_TIMEOUT_MS });
        if (isFailure(run))
            return run.failure === 'denied' || run.failure === 'cli-missing' ? { kind: 'rejected', failure: run } : { kind: 'unknown', message: run.message };
        return parseCollections(run, ids);
    }
    /** Async, with --wait=0, so a job id comes back. A failure here can't say no job exists. */
    async bulkStart(username, operation, object, csv) {
        const run = await this.run({ kind: operation === 'update' ? 'bulk.update' : 'bulk.delete', target: username, sobject: object, file: 'rows.csv' }, { payload: csv, timeoutMs: this.options.writeTimeoutMs ?? WRITE_TIMEOUT_MS });
        if (isFailure(run))
            return run;
        const envelope = readEnvelope(run);
        return isFailure(envelope) ? envelope : parseBulkStart(envelope);
    }
    /** GET on the job, with -o. The resume commands take the org from a local cache, or have no target at all. */
    async bulkJob(username, jobId) {
        const run = await this.run({ kind: 'api.get', target: username, path: `/services/data/${API_VERSION}/jobs/ingest/${jobId}` });
        if (isFailure(run))
            return run;
        const answer = readApiAnswer(run);
        return isFailure(answer) ? answer : parseBulkJob(answer);
    }
    /** The CLI writes the result files to the working folder. They hold record data, so that folder is private. */
    async bulkResults(username, jobId, intoDir) {
        mkdirSync(intoDir, { recursive: true });
        const run = await this.run({ kind: 'bulk.results', target: username, jobId }, { cwd: intoDir, timeoutMs: WRITE_TIMEOUT_MS });
        return isFailure(run) ? run : parseBulkResults(run);
    }
    /**
     * For quick, report, and cancel, the CLI lets its own job cache beat --target-org.
     * A job id that the cache sends to some other login is refused here, before the CLI
     * can act on it. The cache is the CLI's, so one this can't read says nothing either way.
     */
    jobCacheProblem(jobId, username) {
        for (const home of [this.options.env.USERPROFILE, this.options.env.HOME]) {
            if (home === undefined)
                continue;
            try {
                const cache = JSON.parse(readFileSync(join(home, '.sf', 'deploy-cache.json'), 'utf8'));
                const target = cache[jobId]?.['target-org'];
                if (typeof target === 'string' && target.toLowerCase() !== username.toLowerCase())
                    return failure('denied', `The CLI's local job cache sends this job to a different login, and that cache beats --target-org, so this was refused.`);
            }
            catch {
                // No cache, or not one this can read.
            }
        }
        return null;
    }
    async deployCall(call, timeoutMs = DEFAULT_TIMEOUT_MS) {
        if (call.kind === 'deploy.quick' || call.kind === 'deploy.report' || call.kind === 'deploy.cancel') {
            const problem = this.jobCacheProblem(call.jobId, call.target);
            if (problem !== null)
                return problem;
        }
        const dir = makePrivateDir();
        try {
            prepareDeployWorkspace(dir);
            const run = await this.run(call, { cwd: dir, timeoutMs });
            return isFailure(run) ? run : parseDeployRun(run);
        }
        finally {
            removePrivateDir(dir);
        }
    }
    deployCheck(username, kind, zip, options) {
        return this.deployCall({ kind, target: username, zip, ignoreWarnings: options.ignoreWarnings }, WRITE_TIMEOUT_MS);
    }
    deployStart(username, zip, options) {
        return this.deployCall({ kind: 'deploy.start', target: username, zip, ignoreWarnings: options.ignoreWarnings }, WRITE_TIMEOUT_MS);
    }
    deployQuick(username, jobId) {
        return this.deployCall({ kind: 'deploy.quick', target: username, jobId }, WRITE_TIMEOUT_MS);
    }
    deployReport(username, jobId) {
        return this.deployCall({ kind: 'deploy.report', target: username, jobId });
    }
    deployCancel(username, jobId) {
        return this.deployCall({ kind: 'deploy.cancel', target: username, jobId });
    }
    async apexRun(username, level, classNames) {
        const run = await this.run({ kind: 'apex.run-test', target: username, level, classNames });
        return isFailure(run) ? run : parseApexRun(run);
    }
    async apexGet(username, runId) {
        const run = await this.run({ kind: 'apex.get-test', target: username, runId });
        return isFailure(run) ? run : parseApexRun(run);
    }
    /** The raw bytes, for hashing and for the rollback snapshot. These stop in the local store, and nothing here returns them to a model. */
    async retrieveManifest(username, manifestXml) {
        const dir = makePrivateDir();
        try {
            writeTempProject(dir);
            const outDir = join(dir, 'out');
            mkdirSync(outDir, { recursive: true });
            const manifest = join(dir, 'package.xml');
            writeFileSync(manifest, manifestXml, { mode: 0o600 });
            const run = await this.run({ kind: 'metadata.retrieve-manifest', target: username, manifest, outDir, zipName: ZIP_NAME }, { cwd: dir, timeoutMs: RETRIEVE_TIMEOUT_MS });
            if (isFailure(run))
                return run;
            const envelope = readEnvelope(run);
            if (isFailure(envelope))
                return envelope;
            const parsed = parseRetrieve(envelope);
            if (isFailure(parsed))
                return parsed;
            const root = join(outDir, ZIP_NAME.replace(/\.zip$/, ''));
            const paths = [];
            if (!walk(root, paths))
                return failure('unknown', `The retrieve holds more than ${MAX_FILES} files, so it was not read, and nothing can be compared.`);
            // The manifest itself can be listed, and it isn't a component.
            const fetched = parsed.fetched.filter(item => !item.startsWith('Package:'));
            // Named as fetched and nowhere on disk would read as no drift, so it reads as unknown.
            if (fetched.length > 0 && paths.length === 0)
                return failure('unknown', 'The retrieve named components and left no files where this version looks for them, so nothing can be compared.');
            return { files: paths.map(path => ({ path: relative(root, path).split(sep).join('/'), bytes: readFileSync(path) })), problems: parsed.problems, fetched, success: parsed.success, status: parsed.status };
        }
        finally {
            removePrivateDir(dir);
        }
    }
    /** Into a private temp project. Nothing lands in the person's project, and secrets stop here. */
    async retrieve(username, members) {
        const dir = makePrivateDir();
        try {
            writeTempProject(dir);
            const outDir = join(dir, 'out');
            mkdirSync(outDir, { recursive: true });
            const run = await this.run({ kind: 'metadata.retrieve', target: username, members, outDir, zipName: ZIP_NAME }, { cwd: dir, timeoutMs: RETRIEVE_TIMEOUT_MS });
            if (isFailure(run))
                return run;
            const envelope = readEnvelope(run);
            if (isFailure(envelope))
                return envelope;
            const parsed = parseRetrieve(envelope);
            if (isFailure(parsed))
                return parsed;
            const fetched = new Set(parsed.fetched.map(item => item.toLowerCase()));
            const files = readRetrievedFiles(join(outDir, ZIP_NAME.replace(/\.zip$/, '')));
            if (files === null)
                return failure('unknown', `The retrieve holds more than ${MAX_FILES} files, so it was not read, and nothing can be compared.`);
            return {
                files,
                problems: parsed.problems,
                missing: members.filter(member => !fetched.has(member.toLowerCase())),
                success: parsed.success,
                status: parsed.status,
            };
        }
        finally {
            removePrivateDir(dir);
        }
    }
}
/** False when the list stopped at the limit, which a caller must not read as the whole tree. */
export function walk(dir, into, limit = MAX_FILES) {
    let names;
    try {
        names = readdirSync(dir);
    }
    catch {
        return true;
    }
    for (const name of names.sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (!walk(path, into, limit))
                return false;
        }
        else {
            if (into.length >= limit)
                return false;
            into.push(path);
        }
    }
    return true;
}
export function hashContent(bytes) {
    const text = bytes.includes(0) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    return createHash('sha256').update(text).digest('hex');
}
/** Redacted text, or null for a binary file or one too large to read. The raw bytes go no further. */
function readRetrievedFiles(root) {
    const paths = [];
    if (!walk(root, paths))
        return null;
    return paths.map(path => {
        const bytes = readFileSync(path);
        const relativePath = relative(root, path).split(sep).join('/');
        const base = { path: relativePath, bytes: bytes.length, sha256: hashContent(bytes) };
        if (bytes.includes(0) || bytes.length > MAX_READ_BYTES)
            return { ...base, text: null, redactions: 0 };
        const text = bytes.toString('utf8');
        if (text.trimStart().startsWith('<')) {
            const redacted = redactXml(text);
            return { ...base, text: redacted.text, redactions: redacted.redactions };
        }
        const redacted = redactSecrets(text);
        return { ...base, text: redacted, redactions: redacted === text ? 0 : 1 };
    });
}
