import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import { normalizeRoot } from './contract.js';
export const APEX_TEST_LEVELS = ['RunLocalTests', 'RunAllTestsInOrg', 'RunSpecifiedTests'];
/** What the CLI's target flag would treat as an access token: core's accessTokenRegex and jwtTokenRegex. */
const TOKEN_SHAPE = /00D\w{12,15}![.\w]*/;
const JWT_SHAPE = /eyJ[A-Za-z0-9+=_-]+\.[A-Za-z0-9+=_-]+\.[A-Za-z0-9+=_-]+/;
export function assertTarget(value) {
    if (value.length === 0 || value === 'default')
        throw new Error('The CLI default org is not a target.');
    if (value.startsWith('-'))
        throw new Error('A target cannot start with a dash.');
    if (TOKEN_SHAPE.test(value) || JWT_SHAPE.test(value))
        throw new Error('That target has the shape of a token, so it is refused.');
    if (value.length > 255 || /[\s\p{Cc}]/u.test(value))
        throw new Error('That is not a username or an alias.');
    return value;
}
function assertValue(value, what) {
    if (value.length === 0 || value.startsWith('-') || /[\r\n\0]/.test(value))
        throw new Error(`Refused ${what}.`);
    return value;
}
const SOBJECT = /^[A-Za-z][A-Za-z0-9_]*$/;
const ZIP_NAME = /^[A-Za-z0-9._-]+\.zip$/;
export const METADATA_MEMBER = /^[A-Za-z][A-Za-z0-9]*:[A-Za-z0-9_][A-Za-z0-9_.\-/ ]*$/;
const REPORT_PATH = /^\/services\/data\/v\d{2,3}\.0\/analytics\/reports\/00O[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?(?:\/describe|\?includeDetails=true)?$/;
const BULK_JOB_PATH = /^\/services\/data\/v\d{2,3}\.0\/jobs\/ingest\/750[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
export const MAX_RETRIEVE_MEMBERS = 50;
/** The only REST write this service can make. One path, one method, nothing built from a value. */
export const COLLECTIONS_PATH = '/services/data/v66.0/composite/sobjects';
export const COLLECTIONS_METHOD = 'PATCH';
/** Over this, a record write goes through Bulk. Salesforce caps sObject Collections at this. */
export const COLLECTIONS_MAX_RECORDS = 200;
const DEPLOY_ID = /^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const BULK_JOB_ID = /^750[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const TEST_RUN_ID = /^707[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const APEX_CLASS = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;
export const MAX_TEST_CLASSES = 50;
function assertId(value, shape, what) {
    if (!shape.test(value))
        throw new Error(`Refused ${what}.`);
    return value;
}
/** Metadata format with package.xml at the root, async, and never an option from a caller. */
function deployArgs(head, call, tail) {
    return [
        ...head,
        `--target-org=${assertTarget(call.target)}`,
        `--metadata-dir=${assertValue(call.zip, 'a deploy zip')}`,
        '--single-package',
        ...tail,
        // Only as an exception an approved plan names.
        ...(call.ignoreWarnings === true ? ['--ignore-warnings'] : []),
        '--async',
        '--json',
    ];
}
/** Every call passes flags as --flag=value, so a value can never be read as another flag. */
export function argsFor(call) {
    switch (call.kind) {
        case 'version':
            return ['version', '--verbose', '--json'];
        case 'org.display':
            return ['org', 'display', `--target-org=${assertTarget(call.target)}`, '--json'];
        case 'data.query':
            return [
                'data',
                'query',
                `--target-org=${assertTarget(call.target)}`,
                `--file=${assertValue(call.file, 'a query file')}`,
                ...(call.tooling === true ? ['--use-tooling-api'] : []),
                ...(call.allRows === true ? ['--all-rows'] : []),
                '--json',
            ];
        case 'sobject.describe':
            if (!SOBJECT.test(call.sobject))
                throw new Error('Refused an object name.');
            return ['sobject', 'describe', `--target-org=${assertTarget(call.target)}`, `--sobject=${call.sobject}`, '--json'];
        case 'api.get':
            // Reads on a closed list of paths. The one REST write is records.collections below.
            if (!REPORT_PATH.test(call.path) && !BULK_JOB_PATH.test(call.path))
                throw new Error('That REST path is not on the closed list.');
            return ['api', 'request', 'rest', call.path, '--method=GET', `--target-org=${assertTarget(call.target)}`, '--json'];
        case 'metadata.retrieve':
            if (call.members.length === 0 || call.members.length > MAX_RETRIEVE_MEMBERS)
                throw new Error(`A retrieve names 1 to ${MAX_RETRIEVE_MEMBERS} members.`);
            for (const member of call.members)
                if (!METADATA_MEMBER.test(member))
                    throw new Error('Refused a metadata member. Wildcards are not allowed.');
            if (!ZIP_NAME.test(call.zipName))
                throw new Error('Refused a zip name.');
            return [
                'project',
                'retrieve',
                'start',
                `--target-org=${assertTarget(call.target)}`,
                ...call.members.map(member => `--metadata=${member}`),
                `--target-metadata-dir=${assertValue(call.outDir, 'an output folder')}`,
                `--zip-file-name=${call.zipName}`,
                '--unzip',
                '--wait=5',
                '--json',
            ];
        case 'metadata.retrieve-manifest':
            if (!ZIP_NAME.test(call.zipName))
                throw new Error('Refused a zip name.');
            return [
                'project',
                'retrieve',
                'start',
                `--target-org=${assertTarget(call.target)}`,
                `--manifest=${assertValue(call.manifest, 'a manifest')}`,
                `--target-metadata-dir=${assertValue(call.outDir, 'an output folder')}`,
                `--zip-file-name=${call.zipName}`,
                '--unzip',
                '--wait=5',
                '--json',
            ];
        case 'records.collections':
            return ['api', 'request', 'rest', COLLECTIONS_PATH, `--method=${COLLECTIONS_METHOD}`, '--header=Content-Type:application/json', `--body=@${assertValue(call.bodyFile, 'a request body')}`, `--target-org=${assertTarget(call.target)}`, '--json'];
        case 'bulk.update':
            if (!SOBJECT.test(call.sobject))
                throw new Error('Refused an object name.');
            return ['data', 'update', 'bulk', `--target-org=${assertTarget(call.target)}`, `--sobject=${call.sobject}`, `--file=${assertValue(call.file, 'a CSV file')}`, '--line-ending=LF', '--column-delimiter=COMMA', '--wait=0', '--json'];
        case 'bulk.delete':
            if (!SOBJECT.test(call.sobject))
                throw new Error('Refused an object name.');
            return ['data', 'delete', 'bulk', `--target-org=${assertTarget(call.target)}`, `--sobject=${call.sobject}`, `--file=${assertValue(call.file, 'a CSV file')}`, '--line-ending=LF', '--wait=0', '--json'];
        case 'bulk.results':
            return ['data', 'bulk', 'results', `--job-id=${assertId(call.jobId, BULK_JOB_ID, 'a bulk job id')}`, `--target-org=${assertTarget(call.target)}`, '--json'];
        case 'deploy.validate':
            return deployArgs(['project', 'deploy', 'validate'], call, ['--test-level=RunLocalTests']);
        case 'deploy.dry-run':
            return deployArgs(['project', 'deploy', 'start'], call, ['--dry-run', '--test-level=RunLocalTests']);
        case 'deploy.start':
            return deployArgs(['project', 'deploy', 'start'], call, []);
        case 'deploy.quick':
            return ['project', 'deploy', 'quick', `--job-id=${assertId(call.jobId, DEPLOY_ID, 'a validation job id')}`, `--target-org=${assertTarget(call.target)}`, '--async', '--json'];
        case 'deploy.report':
            return ['project', 'deploy', 'report', `--job-id=${assertId(call.jobId, DEPLOY_ID, 'a deploy id')}`, `--target-org=${assertTarget(call.target)}`, '--json'];
        case 'deploy.cancel':
            return ['project', 'deploy', 'cancel', `--job-id=${assertId(call.jobId, DEPLOY_ID, 'a deploy id')}`, `--target-org=${assertTarget(call.target)}`, '--async', '--json'];
        case 'apex.run-test': {
            if (!APEX_TEST_LEVELS.includes(call.level))
                throw new Error('Refused a test level.');
            const names = call.classNames ?? [];
            if (names.length > MAX_TEST_CLASSES || names.some(name => !APEX_CLASS.test(name)))
                throw new Error('Refused a test class name.');
            if (call.level === 'RunSpecifiedTests' && names.length === 0)
                throw new Error('RunSpecifiedTests names at least one class.');
            if (call.level !== 'RunSpecifiedTests' && names.length > 0)
                throw new Error('Only RunSpecifiedTests names classes.');
            // No --wait and no --synchronous, so it comes back with a run id.
            return ['apex', 'run', 'test', `--target-org=${assertTarget(call.target)}`, `--test-level=${call.level}`, ...names.map(name => `--class-names=${name}`), '--code-coverage', '--result-format=json', '--json'];
        }
        case 'apex.get-test':
            return ['apex', 'get', 'test', `--test-run-id=${assertId(call.runId, TEST_RUN_ID, 'a test run id')}`, `--target-org=${assertTarget(call.target)}`, '--code-coverage', '--result-format=json', '--json'];
        default: {
            const exhaustive = call;
            throw new Error(`Unknown CLI call: ${JSON.stringify(exhaustive)}`);
        }
    }
}
const ENV_ALLOWLIST = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
const PROXY_NAMES = new Set(['http_proxy', 'https_proxy', 'no_proxy']);
/**
 * What a login that works in the person's own shell can need and nothing else: the certificates their network
 * signs with, and where the CLI finds its keychain (@salesforce/core envVars and keyChainImpl). None of these
 * names an org, a token, or code to run.
 */
const TRUST_AND_KEYCHAIN = ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SF_USE_GENERIC_UNIX_KEYCHAIN', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'];
function envValue(env, name) {
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(env))
        if (key.toLowerCase() === wanted && value !== undefined)
            return value;
    return undefined;
}
/** An allowlist, not a filter. Nothing named SF_, SFDX_, or NODE_ comes through from the host, except the few in TRUST_AND_KEYCHAIN. */
export function scrubEnv(source) {
    const env = {};
    for (const name of ENV_ALLOWLIST) {
        const value = envValue(source, name);
        if (value !== undefined)
            env[name] = value;
    }
    for (const [key, value] of Object.entries(source)) {
        if (value !== undefined && PROXY_NAMES.has(key.toLowerCase()))
            env[key] = value;
    }
    for (const name of TRUST_AND_KEYCHAIN) {
        const value = envValue(source, name);
        if (value !== undefined)
            env[name] = value;
    }
    env.NO_COLOR = '1';
    env.FORCE_COLOR = '0';
    env.SF_DISABLE_AUTOUPDATE = 'true';
    return env;
}
/**
 * Contract section 5. Deploys: 0 success, 1 failed or canceled, 68 partial, 69 in
 * progress. A read has no partial or in-progress code, so those mean unknown.
 */
export function exitMeaning(family, code) {
    if (code === 0)
        return 'success';
    if (family === 'deploy') {
        switch (code) {
            case 1:
                return 'failed';
            case 68:
                return 'partial';
            case 69:
                return 'in-progress';
            default:
                return 'unknown';
        }
    }
    return code === 68 || code === 69 ? 'unknown' : 'failed';
}
function isFile(path) {
    try {
        return statSync(path).isFile();
    }
    catch {
        return false;
    }
}
function realpath(path) {
    try {
        return realpathSync(path);
    }
    catch {
        return path;
    }
}
function isInside(path, folder) {
    const child = normalizeRoot(realpath(path));
    const parent = normalizeRoot(realpath(folder));
    return child === parent || child.startsWith(`${parent}/`);
}
const LAUNCHERS = ['sf.cmd', 'sf', 'sf.exe', 'sf.ps1'];
/**
 * What `sf update` leaves behind (oclif plugin-update): a redirect stub at client/bin/sf, and the real
 * CLI in client/<version>/bin/run.js. Every version still on disk is listed, newest first.
 */
function versionedClients(clientRoot) {
    if (basename(clientRoot) !== 'client')
        return [];
    let names;
    try {
        names = readdirSync(clientRoot);
    }
    catch {
        return [];
    }
    const rank = (name) => {
        const match = name.match(/^(\d+)\.(\d+)\.(\d+)(?:-|$)/);
        return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    return names
        .map(name => ({ name, rank: rank(name) }))
        .filter((item) => item.rank !== null)
        .sort((left, right) => right.rank[0] - left.rank[0] || right.rank[1] - left.rank[1] || right.rank[2] - left.rank[2])
        .map(item => join(clientRoot, item.name, 'bin', 'run.js'));
}
function layoutsFrom(dir) {
    return [
        ...versionedClients(join(dir, '..')), // after sf update
        join(dir, 'node_modules', '@salesforce', 'cli', 'bin', 'run.js'), // npm global, Windows
        join(dir, '..', 'lib', 'node_modules', '@salesforce', 'cli', 'bin', 'run.js'), // npm global, POSIX
        join(dir, '..', '@salesforce', 'cli', 'bin', 'run.js'), // node_modules/.bin
        join(dir, '..', 'client', 'bin', 'run.js'), // installer
        join(dir, '..', 'client', 'bin', 'run'),
        join(dir, 'run.js'), // tarball
        join(dir, 'run'),
    ];
}
function updatedClient(env) {
    const local = envValue(env, 'LOCALAPPDATA');
    const home = envValue(env, 'HOME') ?? envValue(env, 'USERPROFILE');
    const candidates = [
        ...(local !== undefined ? [join(local, 'sf', 'client', 'bin')] : []),
        ...(home !== undefined ? [join(home, '.local', 'share', 'sf', 'client', 'bin')] : []),
    ];
    for (const dir of candidates)
        if (LAUNCHERS.some(name => isFile(join(dir, name))))
            return dir;
    return null;
}
function nodeVersionOf(node) {
    const ran = spawnSync(node, ['--version'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000 });
    const match = typeof ran.stdout === 'string' ? ran.stdout.match(/^v(\d+)\./) : null;
    return match ? Number(match[1]) : 0;
}
/** Prefers a node beside the CLI, since the installer bundles one and the server's may be older. */
function pickNode(entry, launcherDir) {
    const exe = process.platform === 'win32' ? 'node.exe' : 'node';
    for (const sibling of [join(dirname(entry), exe), join(launcherDir, exe)]) {
        if (isFile(sibling) && nodeVersionOf(sibling) >= 22)
            return sibling;
    }
    return Number(process.versions.node.split('.')[0]) >= 22 ? process.execPath : null;
}
export async function resolveCli(options) {
    const tried = [];
    const launcherDirs = [];
    for (const entry of (envValue(options.env, 'PATH') ?? '').split(delimiter)) {
        if (entry.length === 0)
            continue;
        if (!isAbsolute(entry)) {
            tried.push(`skipped relative PATH entry ${entry}`);
            continue;
        }
        if (isInside(entry, options.projectRoot)) {
            tried.push(`skipped PATH entry in the project ${entry}`);
            continue;
        }
        if (LAUNCHERS.some(name => isFile(join(entry, name))))
            launcherDirs.push(entry);
        else
            tried.push(`no sf in ${entry}`);
    }
    const updated = launcherDirs.length > 0 ? updatedClient(options.env) : null;
    for (const launcherDir of [...(updated !== null ? [updated] : []), ...launcherDirs]) {
        for (const candidate of layoutsFrom(launcherDir)) {
            tried.push(candidate);
            if (!isFile(candidate))
                continue;
            const node = pickNode(candidate, launcherDir);
            if (node === null) {
                tried.push(`no Node 22 or later for ${candidate}`);
                continue;
            }
            const confirmed = await confirmCli(node, candidate, options);
            if (typeof confirmed !== 'string')
                return confirmed;
            tried.push(`${candidate}: ${confirmed}`);
        }
    }
    return { error: 'cli-missing', message: `The Salesforce CLI could not be confirmed, so nothing ran. Tried: ${tried.join('; ') || 'PATH is empty'}`, tried };
}
async function confirmCli(node, entry, options) {
    const unconfirmed = { node, entry, cliVersion: '', rootPath: '' };
    const run = await runSf(unconfirmed, { kind: 'version' }, { env: options.env, timeoutMs: options.versionTimeoutMs ?? 60_000 });
    if (run.outcome !== 'exited' || run.code !== 0)
        return 'the version check did not finish cleanly';
    let parsed;
    try {
        parsed = JSON.parse(run.stdout);
    }
    catch {
        return 'the version check did not print JSON';
    }
    // oclif's own commands print the result with no {status, result} wrapper.
    const body = (parsed !== null && typeof parsed === 'object' && 'result' in parsed ? parsed.result : parsed);
    const cliVersion = body?.cliVersion;
    const rootPath = body?.rootPath;
    if (typeof cliVersion !== 'string' || !/^@salesforce\/cli\/\d+\.\d+\.\d+/.test(cliVersion))
        return 'the version check did not name @salesforce/cli';
    if (typeof rootPath !== 'string' || !isInside(entry, rootPath))
        return 'the version check named a different install';
    return { node, entry, cliVersion, rootPath };
}
export const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024;
const PAYLOAD_FILE = 'payload.tmp';
const KILL_GRACE_MS = 2_000;
export function makePrivateDir() {
    return mkdtempSync(join(tmpdir(), 'topia-sf-'));
}
export function removePrivateDir(dir) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
/** A throwaway project for a command that requires one, so no project of the person's shapes the call. */
export function writeTempProject(dir) {
    mkdirSync(join(dir, 'force-app'), { recursive: true });
    writeFileSync(join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '66.0' }));
}
export const DEPLOY_WORKSPACE = 'temp-project';
export function prepareDeployWorkspace(dir, workspace = DEPLOY_WORKSPACE) {
    if (workspace === 'temp-project')
        writeTempProject(dir);
}
/**
 * A timeout or a kill is reported as itself. The caller reads it as unknown,
 * never as stopped: a job in the org keeps running after the CLI is gone.
 */
export async function runSf(cli, call, options) {
    const owned = options.cwd === undefined;
    const cwd = options.cwd ?? makePrivateDir();
    try {
        let actual = call;
        if (call.kind === 'data.query' && options.soql !== undefined) {
            const file = join(cwd, 'query.soql');
            writeFileSync(file, options.soql, { mode: 0o600 });
            actual = { ...call, file };
        }
        if (options.payload !== undefined) {
            const payloadFile = join(cwd, PAYLOAD_FILE);
            if (call.kind === 'records.collections') {
                writeFileSync(payloadFile, options.payload, { mode: 0o600 });
                actual = { ...call, bodyFile: payloadFile };
            }
            else if (call.kind === 'bulk.update' || call.kind === 'bulk.delete') {
                writeFileSync(payloadFile, options.payload, { mode: 0o600 });
                actual = { ...call, file: payloadFile };
            }
        }
        return await spawnCli(cli, argsFor(actual), cwd, options);
    }
    finally {
        if (owned)
            removePrivateDir(cwd);
        else {
            if (call.kind === 'data.query' && existsSync(join(cwd, 'query.soql')))
                rmSync(join(cwd, 'query.soql'), { force: true });
            if (options.payload !== undefined)
                rmSync(join(cwd, PAYLOAD_FILE), { force: true });
        }
    }
}
function spawnCli(cli, argv, cwd, options) {
    return new Promise(resolve => {
        let settled = false;
        const stdout = [];
        const stderr = [];
        let bytes = 0;
        let timer;
        let grace;
        let stopReason = null;
        const finish = (run) => {
            if (settled)
                return;
            settled = true;
            if (timer !== undefined)
                clearTimeout(timer);
            if (grace !== undefined)
                clearTimeout(grace);
            resolve(run);
        };
        let child;
        try {
            child = spawn(cli.node, ['--no-deprecation', cli.entry, ...argv], {
                shell: false,
                windowsHide: true,
                cwd,
                env: scrubEnv(options.env),
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch (error) {
            finish({ outcome: 'spawn-error', message: error instanceof Error ? error.message : 'spawn failed' });
            return;
        }
        const stop = (reason) => {
            if (stopReason !== null)
                return;
            stopReason = reason;
            child.kill();
            // A grandchild can hold the pipes open past the kill, so don't wait on close forever.
            grace = setTimeout(() => {
                child.kill('SIGKILL');
                finish(reason === 'timeout' ? { outcome: 'timeout' } : { outcome: 'overflow' });
            }, KILL_GRACE_MS);
        };
        timer = setTimeout(() => stop('timeout'), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
        const collect = (into) => (chunk) => {
            bytes += chunk.length;
            if (bytes > limit) {
                stop('overflow');
                return;
            }
            into.push(chunk);
        };
        child.stdout?.on('data', collect(stdout));
        child.stderr?.on('data', collect(stderr));
        child.on('error', error => finish({ outcome: 'spawn-error', message: error.message }));
        child.on('close', (code, signal) => {
            if (stopReason !== null) {
                finish(stopReason === 'timeout' ? { outcome: 'timeout' } : { outcome: 'overflow' });
                return;
            }
            if (code === null) {
                finish({ outcome: 'signal', signal: signal ?? 'unknown' });
                return;
            }
            finish({ outcome: 'exited', code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
        });
    });
}
