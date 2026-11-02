import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { test } from 'node:test'

import { argsFor, assertTarget, COLLECTIONS_METHOD, COLLECTIONS_PATH, exitMeaning, resolveCli, runSf, scrubEnv, type ResolvedCli, type SfCall, type SfRun } from './sf-cli.js'
import { FAKE_BIN, FAKE_ENTRY, FLAG_SNAPSHOT, fakeCalls, fakeHome, writeScenario, type FakeHome } from './test-support.js'

const TARGET = 'ada@example.com'
const REPORT = '00O000000000001AAA'
const BULK_JOB = '750000000000001AAA'
const DEPLOY_JOB = '0Af000000000001AAA'
const TEST_RUN = '707000000000001AAA'

// Every shape of every call the adapter can build. The mapped type makes this a
// compile error when someone adds a call kind and no sample for it.
const SAMPLES: { [K in SfCall['kind']]: Extract<SfCall, { kind: K }>[] } = {
  version: [{ kind: 'version' }],
  'org.display': [{ kind: 'org.display', target: TARGET }],
  'data.query': [
    { kind: 'data.query', target: TARGET, file: '/tmp/x/query.soql' },
    { kind: 'data.query', target: TARGET, file: '/tmp/x/query.soql', tooling: true },
    { kind: 'data.query', target: TARGET, file: '/tmp/x/query.soql', allRows: true },
  ],
  'sobject.describe': [{ kind: 'sobject.describe', target: TARGET, sobject: 'Widget__c' }],
  'api.get': [
    { kind: 'api.get', target: TARGET, path: `/services/data/v66.0/analytics/reports/${REPORT}/describe` },
    { kind: 'api.get', target: TARGET, path: `/services/data/v66.0/analytics/reports/${REPORT}?includeDetails=true` },
  ],
  'metadata.retrieve': [{ kind: 'metadata.retrieve', target: TARGET, members: ['ApexClass:Widget', 'CustomObject:Widget__c'], outDir: '/tmp/x/out', zipName: 'retrieved.zip' }],
  'metadata.retrieve-manifest': [{ kind: 'metadata.retrieve-manifest', target: TARGET, manifest: '/tmp/x/package.xml', outDir: '/tmp/x/out', zipName: 'retrieved.zip' }],
  'records.collections': [{ kind: 'records.collections', target: TARGET, bodyFile: '/tmp/x/body.json' }],
  'bulk.update': [{ kind: 'bulk.update', target: TARGET, sobject: 'Widget__c', file: '/tmp/x/rows.csv' }],
  'bulk.delete': [{ kind: 'bulk.delete', target: TARGET, sobject: 'Widget__c', file: '/tmp/x/rows.csv' }],
  'bulk.results': [{ kind: 'bulk.results', target: TARGET, jobId: BULK_JOB }],
  'deploy.validate': [
    { kind: 'deploy.validate', target: TARGET, zip: '/tmp/x/a.zip' },
    { kind: 'deploy.validate', target: TARGET, zip: '/tmp/x/a.zip', ignoreWarnings: true },
  ],
  'deploy.dry-run': [
    { kind: 'deploy.dry-run', target: TARGET, zip: '/tmp/x/a.zip' },
    { kind: 'deploy.dry-run', target: TARGET, zip: '/tmp/x/a.zip', ignoreWarnings: true },
  ],
  'deploy.start': [
    { kind: 'deploy.start', target: TARGET, zip: '/tmp/x/a.zip' },
    { kind: 'deploy.start', target: TARGET, zip: '/tmp/x/a.zip', ignoreWarnings: true },
  ],
  'deploy.quick': [{ kind: 'deploy.quick', target: TARGET, jobId: DEPLOY_JOB }],
  'deploy.report': [{ kind: 'deploy.report', target: TARGET, jobId: DEPLOY_JOB }],
  'deploy.cancel': [{ kind: 'deploy.cancel', target: TARGET, jobId: DEPLOY_JOB }],
  'apex.run-test': [
    { kind: 'apex.run-test', target: TARGET, level: 'RunLocalTests' },
    { kind: 'apex.run-test', target: TARGET, level: 'RunAllTestsInOrg' },
    { kind: 'apex.run-test', target: TARGET, level: 'RunSpecifiedTests', classNames: ['WidgetTest', 'vendorco.GadgetTest'] },
  ],
  'apex.get-test': [{ kind: 'apex.get-test', target: TARGET, runId: TEST_RUN }],
}

/** Contract section 5. No argv this service can build holds any of these. */
const BANNED = ['--flags-dir', '--ignore-errors', '--ignore-conflicts', '--purge-on-delete', '--hard-delete', '--use-most-recent', '--stream-to-file', '--query', '--output-file', '--pre-destructive-changes', '--post-destructive-changes', '--synchronous']

/** Each of these is allowed on exactly one kind of call, and the test below says which. */
const CLOSED: Record<string, (call: SfCall) => boolean> = {
  '--ignore-warnings': call => (call.kind === 'deploy.validate' || call.kind === 'deploy.dry-run' || call.kind === 'deploy.start') && call.ignoreWarnings === true,
  '--body': call => call.kind === 'records.collections',
  '--header': call => call.kind === 'records.collections',
}

type Snapshot = { cliVersion: string; commands: Record<string, { flags: Record<string, { type: string; options?: string[]; multiple?: boolean }>; args: string[] }> }

function snapshot(): Snapshot {
  return JSON.parse(readFileSync(FLAG_SNAPSHOT, 'utf8')) as Snapshot
}

function everyCall(): SfCall[] {
  return Object.values(SAMPLES).flat() as SfCall[]
}

test('the snapshot records the CLI version it was taken from', () => {
  assert.equal(snapshot().cliVersion, '2.156.8')
})

test('every argv we can build uses only flags that exist on that command', () => {
  const { commands } = snapshot()
  for (const call of everyCall()) {
    const argv = argsFor(call)
    const words = argv.filter(word => !word.startsWith('-'))
    const name = Object.keys(commands).filter(id => argv.join(' ').startsWith(id)).sort((a, b) => b.length - a.length)[0]
    assert.ok(name, `No snapshot command for ${argv.join(' ')}`)
    const spec = commands[name]
    assert.ok(spec)
    const positional = words.slice(name.split(' ').length)
    assert.ok(positional.length <= spec.args.length, `${name} takes ${spec.args.length} positional arguments: ${positional.join(' ')}`)
    for (const word of argv.filter(item => item.startsWith('-'))) {
      const match = word.match(/^--([a-z-]+)(=(.*))?$/s)
      assert.ok(match, `${word} is not in --flag=value form`)
      const flagName = match[1] ?? ''
      const flag = spec.flags[flagName]
      assert.ok(flag, `${name} has no flag --${flagName}`)
      if (flag.type === 'option') assert.ok(match[2], `--${flagName} needs a value`)
      if (flag.type === 'boolean') assert.equal(match[2], undefined, `--${flagName} takes no value`)
      if (flag.options) assert.ok(flag.options.includes(match[3] ?? ''), `--${flagName}=${match[3]} is not an option`)
      if (!flag.multiple) assert.equal(argv.filter(item => item === word || item.startsWith(`--${flagName}=`)).length, 1, `--${flagName} is not repeatable`)
    }
  }
})

test('every org call names its target, and none can reach a forbidden flag or command', () => {
  for (const call of everyCall()) {
    const argv = argsFor(call)
    if (call.kind !== 'version') assert.ok(argv.includes(`--target-org=${TARGET}`), argv.join(' '))
    if (call.kind !== 'version') assert.ok(argv.includes('--json'), argv.join(' '))
    const has = (flag: string) => argv.some(word => word === flag || word.startsWith(`${flag}=`))
    for (const flag of BANNED) assert.equal(has(flag), false, `${flag} in ${argv.join(' ')}`)
    for (const [flag, allowed] of Object.entries(CLOSED)) assert.equal(has(flag), allowed(call), `${flag} in ${argv.join(' ')}`)
    // `apex run test` is the one form of `apex run`, and anonymous Apex has no route.
    if (argv.slice(0, 2).join(' ') === 'apex run') assert.equal(argv[2], 'test', argv.join(' '))
    // A check-only or test call never skips or narrows its tests.
    for (const word of argv) assert.equal(/^--test-level=(NoTestRun|RunRelevantTests)$/.test(word), false, word)
    if (call.kind === 'deploy.validate' || call.kind === 'deploy.dry-run') assert.ok(argv.includes('--test-level=RunLocalTests'), argv.join(' '))
    if (call.kind === 'deploy.start') assert.equal(argv.includes('--dry-run'), false, argv.join(' '))
    if (call.kind === 'deploy.dry-run') assert.ok(argv.includes('--dry-run'), argv.join(' '))
  }
})

test('the banned flags and commands have no route in the source that builds argv', () => {
  const source = readFileSync(join(dirname(FLAG_SNAPSHOT), '..', 'sf-cli.ts'), 'utf8')
  for (const flag of ['--flags-dir', '--ignore-errors', '--ignore-conflicts', '--purge-on-delete', '--hard-delete', '--use-most-recent', 'NoTestRun', 'RunRelevantTests']) {
    assert.equal(source.includes(flag), false, flag)
  }
})

test('bulk writes say --wait=0 and --line-ending out loud, and never a hard delete', () => {
  for (const call of [...SAMPLES['bulk.update'], ...SAMPLES['bulk.delete']]) {
    const argv = argsFor(call)
    assert.ok(argv.includes('--wait=0'), argv.join(' '))
    assert.ok(argv.includes('--line-ending=LF'), argv.join(' '))
    assert.equal(argv.includes('--hard-delete'), false)
  }
})

test('deploys send the zip in metadata format, async, so a job id always comes back', () => {
  for (const call of [...SAMPLES['deploy.validate'], ...SAMPLES['deploy.dry-run'], ...SAMPLES['deploy.start']]) {
    const argv = argsFor(call)
    assert.ok(argv.includes('--metadata-dir=/tmp/x/a.zip'), argv.join(' '))
    assert.ok(argv.includes('--single-package'), argv.join(' '))
    assert.ok(argv.includes('--async'), argv.join(' '))
    assert.equal(argv.some(word => /^--(source-dir|manifest|metadata)=/.test(word)), false, argv.join(' '))
  }
  const quick = argsFor({ kind: 'deploy.quick', target: TARGET, jobId: DEPLOY_JOB })
  assert.ok(quick.includes(`--job-id=${DEPLOY_JOB}`))
  assert.ok(quick.includes(`--target-org=${TARGET}`))
})

test('job ids are checked by shape, so an id can never carry a flag', () => {
  for (const kind of ['deploy.quick', 'deploy.report', 'deploy.cancel'] as const) {
    for (const jobId of ['--use-most-recent', BULK_JOB, '', `${DEPLOY_JOB} --hard-delete`]) assert.throws(() => argsFor({ kind, target: TARGET, jobId }), Error, jobId)
  }
  assert.throws(() => argsFor({ kind: 'bulk.results', target: TARGET, jobId: DEPLOY_JOB }))
  assert.throws(() => argsFor({ kind: 'apex.get-test', target: TARGET, runId: DEPLOY_JOB }))
})

test('a test run stays on the closed list of levels and names real classes', () => {
  assert.throws(() => argsFor({ kind: 'apex.run-test', target: TARGET, level: 'NoTestRun' as never }))
  assert.throws(() => argsFor({ kind: 'apex.run-test', target: TARGET, level: 'RunSpecifiedTests' }))
  assert.throws(() => argsFor({ kind: 'apex.run-test', target: TARGET, level: 'RunLocalTests', classNames: ['WidgetTest'] }))
  assert.throws(() => argsFor({ kind: 'apex.run-test', target: TARGET, level: 'RunSpecifiedTests', classNames: ['--wait=5'] }))
  assert.equal(argsFor({ kind: 'apex.run-test', target: TARGET, level: 'RunLocalTests' }).some(word => word.startsWith('--wait') || word === '--synchronous'), false)
})

test('every api request rest we can build is GET on a closed list, or the one Collections write', () => {
  const allowedGet = [/^\/services\/data\/v\d+\.0\/analytics\/reports\/00O\w{12,15}(\/describe|\?includeDetails=true)?$/, /^\/services\/data\/v\d+\.0\/jobs\/ingest\/750\w{12,15}$/]
  const samples = [...SAMPLES['api.get'], ...SAMPLES['records.collections'], { kind: 'api.get', target: TARGET, path: `/services/data/v66.0/jobs/ingest/${BULK_JOB}` } as SfCall]
  for (const call of samples) {
    const argv = argsFor(call)
    const method = argv.find(word => word.startsWith('--method='))
    const path = argv[3] ?? ''
    if (method === '--method=GET') assert.ok(allowedGet.some(item => item.test(path)), path)
    else {
      assert.equal(method, '--method=PATCH')
      assert.equal(path, '/services/data/v66.0/composite/sobjects')
    }
  }
  // Nothing else can be asked for: the write's path and method aren't arguments, and a GET can't reach them.
  assert.equal(COLLECTIONS_PATH, '/services/data/v66.0/composite/sobjects')
  assert.equal(COLLECTIONS_METHOD, 'PATCH')
  assert.throws(() => argsFor({ kind: 'api.get', target: TARGET, path: COLLECTIONS_PATH }))
  assert.throws(() => argsFor({ kind: 'api.get', target: TARGET, path: `/services/data/v66.0/jobs/ingest/${BULK_JOB}/successfulResults` }))
  assert.throws(() => argsFor({ kind: 'api.get', target: TARGET, path: `/services/data/v66.0/jobs/ingest/${BULK_JOB}?x=y` }))
  assert.throws(() => argsFor({ kind: 'api.get', target: TARGET, path: `/services/data/v66.0/composite/sobjects?ids=${BULK_JOB}&allOrNone=true` }))
  const source = readFileSync(join(dirname(FLAG_SNAPSHOT), '..', 'sf-cli.ts'), 'utf8')
  assert.equal([...source.matchAll(/--method=/g)].length, 2, 'one GET and one PATCH: a third is a new route')
})

test('record values and queries go through a temp file, never the command line', () => {
  const argv = argsFor({ kind: 'records.collections', target: TARGET, bodyFile: '/tmp/x/body.json' })
  assert.ok(argv.includes('--body=@/tmp/x/body.json'))
  assert.throws(() => argsFor({ kind: 'records.collections', target: TARGET, bodyFile: '-' }))
  assert.throws(() => argsFor({ kind: 'bulk.update', target: TARGET, sobject: 'Widget__c', file: '--hard-delete' }))
  assert.throws(() => argsFor({ kind: 'bulk.delete', target: TARGET, sobject: '--hard-delete', file: '/tmp/x/a.csv' }))
})

test('SOQL never crosses the command line', () => {
  const argv = argsFor({ kind: 'data.query', target: TARGET, file: '/tmp/x/query.soql' })
  assert.ok(argv.includes('--file=/tmp/x/query.soql'))
  assert.equal(argv.some(word => /select/i.test(word)), false)
})

test('org list users is gone, and an unknown call kind throws', () => {
  assert.throws(() => argsFor({ kind: 'org.list.users', target: TARGET } as never))
  assert.throws(() => argsFor({ kind: 'apex.run', target: TARGET } as never))
})

test('a target has to be a target', () => {
  assert.equal(assertTarget(TARGET), TARGET)
  assert.equal(assertTarget('acme-sbx'), 'acme-sbx')
  const refused = [
    '',
    'default',
    '-o',
    '--flags-dir=/tmp/x',
    '00D000000000001!AQEAQSYNTHETIC',
    '00D000000000001AAA!AQEAQSYNTHETIC.more_stuff',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl',
    'has space',
    'new\nline',
  ]
  for (const value of refused) assert.throws(() => assertTarget(value), Error, value)
  for (const value of refused) assert.throws(() => argsFor({ kind: 'org.display', target: value }), Error, value)
})

test('other values reject a leading dash and unsafe shapes', () => {
  assert.throws(() => argsFor({ kind: 'sobject.describe', target: TARGET, sobject: '--flags-dir=/x' }))
  assert.throws(() => argsFor({ kind: 'sobject.describe', target: TARGET, sobject: 'Widget__c; drop' }))
  assert.throws(() => argsFor({ kind: 'data.query', target: TARGET, file: '-x' }))
  assert.throws(() => argsFor({ kind: 'metadata.retrieve', target: TARGET, members: ['--ignore-conflicts'], outDir: '/tmp/x', zipName: 'a.zip' }))
  assert.throws(() => argsFor({ kind: 'metadata.retrieve', target: TARGET, members: ['ApexClass:*'], outDir: '/tmp/x', zipName: 'a.zip' }))
  assert.throws(() => argsFor({ kind: 'metadata.retrieve', target: TARGET, members: [], outDir: '/tmp/x', zipName: 'a.zip' }))
})

test('api request rest is GET on the closed list of paths, and nothing else', () => {
  const argv = argsFor({ kind: 'api.get', target: TARGET, path: `/services/data/v66.0/analytics/reports/${REPORT}/describe` })
  assert.ok(argv.includes('--method=GET'))
  const refused = [
    '/services/data/v66.0/sobjects/Widget__c',
    '/services/data/v66.0/composite/sobjects',
    '/services/data/v66.0/tooling/executeAnonymous?anonymousBody=x',
    `/services/data/v66.0/analytics/reports/${REPORT}/../../sobjects`,
    `https://attacker.example/services/data/v66.0/analytics/reports/${REPORT}`,
    `--body=/services/data/v66.0/analytics/reports/${REPORT}`,
    `/services/data/v66.0/analytics/reports/${REPORT}?includeDetails=true&x=y`,
  ]
  for (const path of refused) assert.throws(() => argsFor({ kind: 'api.get', target: TARGET, path }), Error, path)
})

test('the few variables a working login needs on some machines come through, and nothing that picks an org or a token does', () => {
  const env = scrubEnv({
    PATH: '/bin',
    NODE_EXTRA_CA_CERTS: '/certs/corp.pem',
    SSL_CERT_FILE: '/certs/bundle.pem',
    SF_USE_GENERIC_UNIX_KEYCHAIN: 'true',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    XDG_RUNTIME_DIR: '/run/user/1000',
    SF_ACCESS_TOKEN: 'SYNTHETIC',
    SF_TARGET_ORG: 'prod',
    NODE_OPTIONS: '--require=/tmp/evil.js',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
  })
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/certs/corp.pem')
  assert.equal(env.SSL_CERT_FILE, '/certs/bundle.pem')
  assert.equal(env.SF_USE_GENERIC_UNIX_KEYCHAIN, 'true')
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/run/user/1000/bus')
  assert.equal(env.XDG_RUNTIME_DIR, '/run/user/1000')
  for (const name of ['SF_ACCESS_TOKEN', 'SF_TARGET_ORG', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED']) assert.equal(name in env, false, name)
})

test('the environment is an allowlist', () => {
  const env = scrubEnv({
    Path: '/bin',
    SystemRoot: 'C:/Windows',
    TEMP: '/t',
    TMP: '/t2',
    HOME: '/h',
    USERPROFILE: '/u',
    APPDATA: '/a',
    LOCALAPPDATA: '/l',
    HTTPS_PROXY: 'http://proxy.example',
    no_proxy: 'localhost',
    SF_TARGET_ORG: 'prod',
    SF_ACCESS_TOKEN: 'SYNTHETIC',
    SF_ORG_INSTANCE_URL: 'https://attacker.example',
    SFDX_DEFAULTUSERNAME: 'prod',
    NODE_OPTIONS: '--require=/tmp/evil.js',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    FORCE_COLOR: '3',
    ANYTHING_ELSE: 'x',
  })
  assert.deepEqual(env, {
    PATH: '/bin',
    SystemRoot: 'C:/Windows',
    TEMP: '/t',
    TMP: '/t2',
    HOME: '/h',
    USERPROFILE: '/u',
    APPDATA: '/a',
    LOCALAPPDATA: '/l',
    HTTPS_PROXY: 'http://proxy.example',
    no_proxy: 'localhost',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    SF_DISABLE_AUTOUPDATE: 'true',
  })
})

test('exit codes keep their meanings, and a read never treats 68 or 69 as done', () => {
  assert.equal(exitMeaning('deploy', 0), 'success')
  assert.equal(exitMeaning('deploy', 1), 'failed')
  assert.equal(exitMeaning('deploy', 68), 'partial')
  assert.equal(exitMeaning('deploy', 69), 'in-progress')
  assert.equal(exitMeaning('deploy', 3), 'unknown')
  assert.equal(exitMeaning('read', 0), 'success')
  assert.equal(exitMeaning('read', 1), 'failed')
  assert.equal(exitMeaning('read', 68), 'unknown')
  assert.equal(exitMeaning('read', 69), 'unknown')
  assert.equal(exitMeaning('read', 2), 'failed')
})

/** Only the version command, with no imports, so it runs wherever a layout puts it. */
function stubEntry(rootPath: string): string {
  return `process.stdout.write(JSON.stringify({ cliVersion: '@salesforce/cli/2.156.8', rootPath: ${JSON.stringify(rootPath)} }))\n`
}

async function resolved(home: FakeHome, project = home.project): Promise<ResolvedCli> {
  const cli = await resolveCli({ env: home.env, projectRoot: project })
  assert.equal('error' in cli, false, JSON.stringify(cli))
  return cli as ResolvedCli
}

function withHome(body: (home: FakeHome) => Promise<void>): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      await body(home)
    } finally {
      home.cleanup()
    }
  }
}

test('the resolver finds the CLI on PATH and confirms it by version', withHome(async home => {
  writeScenario(home, {})
  const cli = await resolved(home)
  assert.equal(cli.entry, FAKE_ENTRY)
  assert.equal(cli.cliVersion, '@salesforce/cli/2.156.8')
  assert.equal(cli.node, process.execPath)
  const call = fakeCalls(home).find(item => item.command === 'version')
  assert.deepEqual(call?.argv, ['version', '--verbose', '--json'])
}))

test('the resolver skips relative PATH entries, the project, and its node_modules', withHome(async home => {
  writeScenario(home, {})
  const planted = join(home.project, 'tools')
  const plantedModules = join(home.project, 'node_modules', '.bin')
  const marker = join(home.root, 'planted-ran')
  for (const dir of [planted, plantedModules]) {
    mkdirSync(dir, { recursive: true })
    for (const launcher of ['sf', 'sf.cmd']) writeFileSync(join(dir, launcher), '')
    writeFileSync(join(dir, 'run.js'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'x')\nprocess.stdout.write(JSON.stringify({ cliVersion: '@salesforce/cli/9.9.9', rootPath: ${JSON.stringify(dir)} }))\n`)
  }
  const env = { ...home.env, PATH: ['.', 'relative/bin', planted, plantedModules, FAKE_BIN].join(delimiter) }
  const cli = await resolveCli({ env, projectRoot: home.project })
  assert.equal('error' in cli, false)
  assert.equal((cli as ResolvedCli).entry, FAKE_ENTRY)
  assert.equal(existsSync(marker), false)
}))

test('the resolver handles the npm, installer, tarball, and auto-update layouts', withHome(async home => {
  writeScenario(home, {})
  const layouts: { launcherDir: string; entry: string; extraEnv?: Record<string, string> }[] = [
    { launcherDir: 'npm', entry: 'npm/node_modules/@salesforce/cli/bin/run.js' },
    { launcherDir: 'npmlocal/.bin', entry: 'npmlocal/@salesforce/cli/bin/run.js' },
    { launcherDir: 'posix/bin', entry: 'posix/lib/node_modules/@salesforce/cli/bin/run.js' },
    { launcherDir: 'inst/bin', entry: 'inst/client/bin/run.js' },
    { launcherDir: 'inst2/bin', entry: 'inst2/client/bin/run' },
    { launcherDir: 'tar/bin', entry: 'tar/bin/run.js' },
  ]
  for (const layout of layouts) {
    const dir = mkdtempSync(join(home.root, 'layout-'))
    const launcherDir = join(dir, layout.launcherDir)
    mkdirSync(launcherDir, { recursive: true })
    writeFileSync(join(launcherDir, 'sf'), '')
    writeFileSync(join(launcherDir, 'sf.cmd'), '')
    const entry = join(dir, layout.entry)
    mkdirSync(dirname(entry), { recursive: true })
    writeFileSync(entry, stubEntry(dirname(dirname(entry))))
    const cli = await resolveCli({ env: { ...home.env, PATH: launcherDir }, projectRoot: home.project })
    assert.equal('error' in cli, false, `${layout.entry}: ${JSON.stringify(cli)}`)
    assert.equal((cli as ResolvedCli).entry, entry)
  }
  // After `sf update` the data folder holds a redirect stub at client/bin/sf and the live CLI in client/<version>/bin/run.js
  // (oclif plugin-update: Updater.clientBin, createBin). The newest version on disk is the one to use.
  const base = process.platform === 'win32' ? join(home.env.LOCALAPPDATA ?? '', 'sf') : join(home.env.HOME ?? '', '.local', 'share', 'sf')
  const stubs = join(base, 'client', 'bin')
  mkdirSync(stubs, { recursive: true })
  writeFileSync(join(stubs, process.platform === 'win32' ? 'sf.cmd' : 'sf'), '')
  for (const version of ['2.99.1-aaaaaaa', '2.156.8-bbbbbbb', '2.100.0-ccccccc']) {
    const dir = join(base, 'client', version, 'bin')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'run.js'), stubEntry(dirname(dir)))
  }
  const cli = await resolveCli({ env: home.env, projectRoot: home.project })
  assert.equal((cli as ResolvedCli).entry, join(base, 'client', '2.156.8-bbbbbbb', 'bin', 'run.js'))
}))

test('the resolver uses a working node beside the CLI, and skips one that does not run', withHome(async home => {
  const dir = join(home.root, 'bundled', 'bin')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'sf'), '')
  writeFileSync(join(dir, 'sf.cmd'), '')
  writeFileSync(join(dir, 'run.js'), stubEntry(dirname(dir)))
  const exe = process.platform === 'win32' ? 'node.exe' : 'node'
  // Not a program at all, so its version check fails and it is passed over.
  writeFileSync(join(dir, exe), 'junk')
  const skipped = await resolveCli({ env: { ...home.env, PATH: dir }, projectRoot: home.project })
  assert.equal((skipped as ResolvedCli).node, process.execPath)
  if (process.platform !== 'win32') {
    // A shell script stands in for a bundled node, since a script can't pose as an .exe.
    writeFileSync(join(dir, 'node'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo v22.1.0; exit 0; fi\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 })
    chmodSync(join(dir, 'node'), 0o755) // The mode above only applies when a file is created.
    const bundled = await resolveCli({ env: { ...home.env, PATH: dir }, projectRoot: home.project })
    assert.equal((bundled as ResolvedCli).node, join(dir, 'node'))
    writeFileSync(join(dir, 'node'), '#!/bin/sh\necho v18.0.0\n', { mode: 0o755 })
    const old = await resolveCli({ env: { ...home.env, PATH: dir }, projectRoot: home.project })
    assert.equal((old as ResolvedCli).node, process.execPath, 'a bundled node older than 22 is not used')
  }
}))

test('the resolver fails closed and names what it tried', withHome(async home => {
  const empty = join(home.root, 'empty')
  mkdirSync(empty)
  const none = await resolveCli({ env: { ...home.env, PATH: empty }, projectRoot: home.project })
  assert.ok('error' in none)
  assert.match((none as { message: string }).message, /Salesforce CLI/)
  assert.match((none as { message: string }).message, /empty/)

  const noEntry = join(home.root, 'launcher-only')
  mkdirSync(noEntry)
  writeFileSync(join(noEntry, 'sf'), '')
  writeFileSync(join(noEntry, 'sf.cmd'), '')
  const orphan = await resolveCli({ env: { ...home.env, PATH: noEntry }, projectRoot: home.project })
  assert.ok('error' in orphan)
  assert.match((orphan as { message: string }).message, /run\.js/)
}))

test('the resolver refuses a CLI whose version check does not hold up', withHome(async home => {
  for (const scenario of [
    { mode: 'not-json', modeOnVersion: true },
    { mode: 'wrong-shape', modeOnVersion: true },
    { mode: 'timeout', modeOnVersion: true },
    { cliVersion: 'something-else/1.0.0' },
    { rootPath: join(home.root, 'not-the-entry-root') },
  ]) {
    writeScenario(home, scenario)
    const cli = await resolveCli({ env: home.env, projectRoot: home.project, versionTimeoutMs: 1500 })
    assert.ok('error' in cli, JSON.stringify(scenario))
  }
}))

function expectExit(run: SfRun): Extract<SfRun, { outcome: 'exited' }> {
  assert.equal(run.outcome, 'exited', JSON.stringify(run))
  return run as Extract<SfRun, { outcome: 'exited' }>
}

test('the spawn is node on the entry, with the scrubbed environment, in a private folder', withHome(async home => {
  writeScenario(home, { display: { id: '00D000000000001AAA' } })
  const cli = await resolved(home)
  const hostile = {
    ...home.env,
    SF_TARGET_ORG: 'prod',
    SF_ACCESS_TOKEN: 'SYNTHETIC',
    SFDX_DEFAULTUSERNAME: 'prod',
    NODE_OPTIONS: '--no-warnings',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
  }
  const run = expectExit(await runSf(cli, { kind: 'org.display', target: TARGET }, { env: hostile }))
  assert.equal(run.code, 0)
  const call = fakeCalls(home).at(-1)
  assert.ok(call)
  for (const name of ['SF_TARGET_ORG', 'SF_ACCESS_TOKEN', 'SFDX_DEFAULTUSERNAME', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED']) assert.equal(call.env[name], undefined, name)
  assert.equal(call.env.NO_COLOR, '1')
  assert.equal(call.env.FORCE_COLOR, '0')
  assert.equal(call.env.SF_DISABLE_AUTOUPDATE, 'true')
  assert.deepEqual(call.execArgv, ['--no-deprecation'])
  assert.notEqual(call.cwd.toLowerCase(), home.project.toLowerCase())
  assert.equal(call.cwd.toLowerCase().startsWith(tmpdir().toLowerCase()), true)
  assert.equal(existsSync(call.cwd), false, 'the private folder is removed afterwards')
}))

test('SOQL goes through a temp file that is deleted afterwards', withHome(async home => {
  writeScenario(home, { queries: [{ match: 'FROM Widget__c', result: { records: [], totalSize: 0, done: true } }] })
  const cli = await resolved(home)
  const soql = "SELECT Id FROM Widget__c WHERE Name = 'O''Brien %PATH% & | < > !'"
  const run = expectExit(await runSf(cli, { kind: 'data.query', target: TARGET, file: '' }, { env: home.env, soql }))
  assert.equal(run.code, 0, run.stdout)
  const call = fakeCalls(home).at(-1)
  assert.equal(call?.soql, soql)
  assert.equal(JSON.stringify(call?.argv).includes('SELECT'), false)
  const file = String(call?.flags.file)
  assert.equal(existsSync(file), false)
}))

test('a missing executable is an outcome, not a crash', withHome(async home => {
  const cli: ResolvedCli = { node: join(home.root, 'no-such-node'), entry: FAKE_ENTRY, cliVersion: 'x', rootPath: home.root }
  const run = await runSf(cli, { kind: 'org.display', target: TARGET }, { env: home.env })
  assert.equal(run.outcome, 'spawn-error')
}))

test('a timeout is reported as a timeout, and the process is killed', withHome(async home => {
  writeScenario(home, { mode: 'timeout' })
  const cli = await resolved(home)
  const started = Date.now()
  const run = await runSf(cli, { kind: 'org.display', target: TARGET }, { env: home.env, timeoutMs: 600 })
  assert.equal(run.outcome, 'timeout')
  assert.ok(Date.now() - started < 10_000)
}))

test('output past the cap stops the process and reads as overflow', withHome(async home => {
  writeScenario(home, { mode: 'flood' })
  const cli = await resolved(home)
  const run = await runSf(cli, { kind: 'org.display', target: TARGET }, { env: home.env, maxOutputBytes: 1024 * 1024 })
  assert.equal(run.outcome, 'overflow')
}))

test('nothing here leaks outside the isolated home', () => {
  const home = fakeHome()
  try {
    assert.equal(home.env.PATH, FAKE_BIN)
    assert.equal(rmSync(join(home.root, 'nothing'), { force: true }), undefined)
  } finally {
    home.cleanup()
  }
})
