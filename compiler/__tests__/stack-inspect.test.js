/**
 * stack skill — stack-inspect.js: compose summary and the ports rule.
 * Uses rendered-config fixtures (fake services, RFC 5737 / loopback IPs).
 */

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyPort,
  composeConfigArgs,
  EXIT,
  findComposeFiles,
  imageBaseName,
  main,
  safeErrorLine,
  summarize,
} from '../../skills/stack/scripts/stack-inspect.js';

const SCRIPT = resolve(fileURLToPath(import.meta.url), '../../../skills/stack/scripts/stack-inspect.js');
const SECRET = 'SENTINEL_VALUE_MUST_NOT_PRINT';

const CONFIG = {
  name: 'demo',
  services: {
    web: {
      build: { context: '.' },
      ports: [{ mode: 'ingress', protocol: 'tcp', published: '8080', target: 80 }],
      environment: { FAKE_API_KEY: SECRET },
      env_file: [{ path: '/srv/demo/.env', required: true }],
      healthcheck: { test: ['CMD', 'curl', '-f', 'http://localhost/'] },
      depends_on: { db: { condition: 'service_healthy' } },
    },
    db: {
      image: 'postgres:16',
      environment: { POSTGRES_PASSWORD: SECRET },
      ports: [{ protocol: 'tcp', published: '5432', target: 5432 }],
      healthcheck: { test: ['CMD-SHELL', 'pg_isready'] },
    },
    cache: {
      image: 'redis:7',
      ports: [{ host_ip: '127.0.0.1', protocol: 'tcp', published: '6379', target: 6379 }],
      profiles: ['extra'],
    },
    mongoui: {
      image: 'mongo-express:1',
      ports: [{ host_ip: '192.0.2.10', protocol: 'tcp', published: '8081', target: 8081 }],
      profiles: ['tools'],
    },
    store: { image: 'example.com/team/custom-store:2', ports: [{ protocol: 'tcp', target: 27017 }] },
    worker: { build: '.', healthcheck: { disable: true }, expose: ['9000'] },
  },
};

describe('classifyPort and imageBaseName', () => {
  test('image base name drops registry, tag and digest', () => {
    assert.strictEqual(imageBaseName('ghcr.io/org/Postgres-X:16@sha256:abc'), 'postgres-x');
    assert.strictEqual(imageBaseName(undefined), '');
  });

  test('categories by image, by service name and by port', () => {
    assert.strictEqual(classifyPort('x', { image: 'bitnami/postgresql:16' }, 5432), 'db');
    assert.strictEqual(classifyPort('db', { build: '.' }, 1234), 'db');
    assert.strictEqual(classifyPort('kv', { image: 'valkey/valkey' }, 6379), 'cache');
    assert.strictEqual(classifyPort('x', { image: 'example.com/thing' }, 9200), 'search');
    assert.strictEqual(classifyPort('web', { image: 'nginx' }, 80), null);
  });

  test('admin UIs win over the database word in their name', () => {
    assert.strictEqual(classifyPort('mongoui', { image: 'mongo-express' }, 8081), 'admin');
    assert.strictEqual(classifyPort('mq', { image: 'rabbitmq:3-management' }, 15672), 'admin');
    assert.strictEqual(classifyPort('mq', { image: 'rabbitmq:3-management' }, 5672), 'queue');
  });
});

describe('summarize', () => {
  const s = summarize(CONFIG);

  test('lists services, profiles, health and build', () => {
    assert.strictEqual(s.project, 'demo');
    assert.deepStrictEqual(
      s.services.map((x) => x.name),
      ['cache', 'db', 'mongoui', 'store', 'web', 'worker'],
    );
    assert.deepStrictEqual(s.profiles, ['extra', 'tools']);
    const by = Object.fromEntries(s.services.map((x) => [x.name, x]));
    assert.strictEqual(by.web.build, true);
    assert.strictEqual(by.web.health, 'defined');
    assert.deepStrictEqual(by.web.dependsOn, ['db']);
    assert.strictEqual(by.worker.health, 'disabled');
    assert.strictEqual(by.cache.health, 'none');
  });

  test('flags internal ports bound beyond localhost, including random host ports', () => {
    const flagged = s.findings.map((f) => `${f.service}:${f.category}:${f.bind}`).sort();
    assert.deepStrictEqual(flagged, ['db:db:0.0.0.0', 'mongoui:admin:192.0.2.10', 'store:db:0.0.0.0']);
    const store = s.findings.find((f) => f.service === 'store');
    assert.match(store.message, /\(random\)/);
    assert.match(s.findings.find((f) => f.service === 'db').fix, /127\.0\.0\.1:5432:5432/);
    assert.match(s.findings.find((f) => f.service === 'db').fix, /expose/);
  });

  test('loopback binds and public web ports are not flagged', () => {
    assert.ok(!s.findings.some((f) => f.service === 'cache' || f.service === 'web'));
  });

  test('drops environment and env_file entirely', () => {
    const text = JSON.stringify(s);
    assert.ok(!text.includes(SECRET));
    assert.ok(!text.includes('env_file') && !text.includes('/srv/demo/.env'));
  });

  test('short port syntax is understood', () => {
    const r = summarize({ services: { db: { image: 'mysql', ports: ['127.0.0.1:3306:3306', '3307:3306/tcp'] } } });
    assert.strictEqual(r.findings.length, 1);
    assert.strictEqual(r.findings[0].published, '3307');
  });
});

describe('compose files and CLI', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'topia-stack-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const capture = () => {
    const lines = { out: [], err: [] };
    return { lines, io: { stdout: (x) => lines.out.push(x), stderr: (x) => lines.err.push(x) } };
  };

  test('findComposeFiles picks the first primary file and adds overrides', () => {
    assert.deepStrictEqual(findComposeFiles(root), []);
    writeFileSync(join(root, 'docker-compose.yml'), 'services: {}\n');
    writeFileSync(join(root, 'compose.yaml'), 'services: {}\n');
    writeFileSync(join(root, 'compose.override.yaml'), 'services: {}\n');
    assert.deepStrictEqual(findComposeFiles(root), ['compose.yaml', 'compose.override.yaml']);
  });

  test('config args turn interpolation and env-file loading off', () => {
    const args = composeConfigArgs(['compose.yaml']);
    assert.ok(args.includes('--no-interpolate'));
    assert.ok(args.includes('--no-env-resolution'));
    assert.deepStrictEqual(args.slice(0, 3), ['compose', '-f', 'compose.yaml']);
  });

  test('safeErrorLine masks KEY=value and keeps one line', () => {
    assert.strictEqual(safeErrorLine(`bad line FAKE=${SECRET} here\nsecond`), 'bad line FAKE=*** here');
  });

  test('--input with findings exits 5 and prints no values', async () => {
    writeFileSync(join(root, 'config.json'), JSON.stringify(CONFIG));
    const c = capture();
    const code = await main(['--root', root, '--input', 'config.json'], c.io);
    assert.strictEqual(code, EXIT.FINDINGS);
    const text = c.lines.out.join('\n');
    assert.match(text, /port findings \(3\)/);
    assert.ok(!text.includes(SECRET));
  });

  test('--json is parseable', async () => {
    writeFileSync(
      join(root, 'config.json'),
      JSON.stringify({ services: { web: { image: 'nginx', ports: ['80:80'] } } }),
    );
    const c = capture();
    assert.strictEqual(await main(['--root', root, '--input', 'config.json', '--json'], c.io), EXIT.OK);
    assert.deepStrictEqual(JSON.parse(c.lines.out.join('\n')).findings, []);
  });

  test('no compose file exits 3; --dry-run prints the docker command', async () => {
    assert.strictEqual(await main(['--root', root], capture().io), EXIT.NOT_FOUND);
    writeFileSync(join(root, 'compose.yaml'), 'services: {}\n');
    const c = capture();
    assert.strictEqual(await main(['--root', root, '--dry-run'], { ...c.io, docker: 'docker' }), EXIT.OK);
    assert.match(c.lines.out[0], /^docker compose -f compose\.yaml .*config --format json --no-interpolate/);
  });

  test('a missing docker binary exits 1 with guidance', async () => {
    writeFileSync(join(root, 'compose.yaml'), 'services: {}\n');
    const c = capture();
    const code = await main(['--root', root], { ...c.io, docker: join(root, 'no-such-docker') });
    assert.strictEqual(code, EXIT.DOCKER_FAILED);
    assert.match(c.lines.err.join('\n'), /docker compose config failed/);
  });

  test('bad input JSON and unknown flags exit 2', async () => {
    writeFileSync(join(root, 'bad.json'), '{nope');
    assert.strictEqual(await main(['--root', root, '--input', 'bad.json'], capture().io), EXIT.USAGE);
    assert.strictEqual(await main(['--nope'], capture().io), EXIT.USAGE);
  });

  test('runs as a CLI', () => {
    const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    assert.strictEqual(help.status, 0);
    writeFileSync(join(root, 'config.json'), JSON.stringify(CONFIG));
    const run = spawnSync(process.execPath, [SCRIPT, '--root', root, '--input', 'config.json'], { encoding: 'utf8' });
    assert.strictEqual(run.status, EXIT.FINDINGS);
  });
});
