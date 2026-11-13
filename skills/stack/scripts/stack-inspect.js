#!/usr/bin/env node
/**
 * stack-inspect.js — describe a Docker Compose stack and flag risky ports.
 *
 * Reads the stack through `docker compose config --format json` with
 * interpolation and env-file resolution turned off, so .env values are not
 * loaded. The report never includes `environment`, `env_file` or secrets.
 *
 * Usage:
 *   node stack-inspect.js [--root <dir>] [-f <file>]... [--input <config.json>|-]
 *                         [--json] [--dry-run] [--smoke] [--debug] [--out-dir <dir>]
 *
 * Exit codes (see ../references/exit-codes.md):
 *   0 no port findings
 *   1 docker compose config failed (retryable)
 *   2 usage error
 *   3 no compose file found
 *   5 port findings (internal-only service published beyond localhost)
 *
 * No dependencies. Node 18+.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveOutDir } from './env-sync.js';

export const VERSION = '0.1.0';
export const EXIT = { OK: 0, DOCKER_FAILED: 1, USAGE: 2, NOT_FOUND: 3, FINDINGS: 5 };

export const COMPOSE_PRIMARY = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
export const COMPOSE_OVERRIDES = [
  'compose.override.yaml',
  'compose.override.yml',
  'docker-compose.override.yaml',
  'docker-compose.override.yml',
];

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** Order matters: admin UIs first, because `mongo-express` must not read as a database. */
const CATEGORY_PATTERNS = [
  [
    'admin',
    /(adminer|pgadmin|phpmyadmin|mongo-express|redis-commander|redisinsight|portainer|mailhog|mailpit|kafka-ui|kafdrop|dbgate|cloudbeaver)/,
  ],
  [
    'db',
    /(postgres|postgis|timescale|mysql|mariadb|mongo|mssql|sqlserver|oracle|cockroach|clickhouse|cassandra|scylla|couchdb|neo4j|influxdb|arangodb|surrealdb|^db$|^database$)/,
  ],
  ['cache', /(redis|valkey|keydb|memcached|dragonfly|^cache$)/],
  ['queue', /(rabbitmq|kafka|zookeeper|nats|activemq|redpanda|^queue$|^broker$)/],
  ['search', /(elasticsearch|opensearch|solr)/],
];

/** Container ports that are internal by default, whatever the image is called. */
const PORT_CATEGORIES = new Map([
  [5432, 'db'],
  [3306, 'db'],
  [27017, 'db'],
  [1433, 'db'],
  [1521, 'db'],
  [26257, 'db'],
  [9042, 'db'],
  [5984, 'db'],
  [7687, 'db'],
  [8086, 'db'],
  [8123, 'db'],
  [6379, 'cache'],
  [11211, 'cache'],
  [5672, 'queue'],
  [9092, 'queue'],
  [2181, 'queue'],
  [4222, 'queue'],
  [9200, 'search'],
  [9300, 'search'],
  [15672, 'admin'],
]);

/** `ghcr.io/org/postgres-x:16@sha256:..` → `postgres-x` */
export function imageBaseName(image) {
  if (!image) return '';
  const noDigest = String(image).split('@')[0];
  const last = noDigest.split('/').pop();
  return last.split(':')[0].toLowerCase();
}

/**
 * Category for one published port, or null when it may be public.
 * @param {string} serviceName
 * @param {{ image?: string }} service
 * @param {number} target container port
 */
export function classifyPort(serviceName, service, target) {
  const byPort = PORT_CATEGORIES.get(Number(target));
  if (byPort === 'admin') return 'admin';
  const names = [imageBaseName(service.image), String(serviceName).toLowerCase()];
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (names.some((n) => n && pattern.test(n))) return category;
  }
  return byPort ?? null;
}

function normalizePort(port) {
  if (typeof port === 'object' && port !== null) {
    return {
      hostIp: port.host_ip ?? '',
      published: port.published === undefined || port.published === '' ? '' : String(port.published),
      target: Number(port.target),
      protocol: port.protocol ?? 'tcp',
    };
  }
  // Short syntax, in case the input was not normalized: [ip:][host:]container[/proto]
  const [spec, protocol = 'tcp'] = String(port).split('/');
  const parts = spec.split(':');
  const target = Number(parts.pop());
  const published = parts.length ? parts.pop() : '';
  const hostIp = parts.join(':').replace(/^\[|\]$/g, '');
  return { hostIp, published, target, protocol };
}

function healthState(service) {
  const hc = service.healthcheck;
  if (!hc) return 'none';
  if (hc.disable === true) return 'disabled';
  if (Array.isArray(hc.test) && hc.test[0] === 'NONE') return 'disabled';
  return 'defined';
}

/**
 * Summarize a rendered compose config. Drops environment, env_file, secrets.
 * @param {object} config parsed `docker compose config --format json`
 */
export function summarize(config) {
  const services = [];
  const findings = [];
  const profiles = new Set();
  const entries = Object.entries(config?.services ?? {}).sort(([a], [b]) => a.localeCompare(b));

  for (const [name, svc] of entries) {
    const svcProfiles = Array.isArray(svc.profiles) ? svc.profiles : [];
    for (const p of svcProfiles) profiles.add(p);
    const ports = (svc.ports ?? []).map(normalizePort);
    const dependsOn = Array.isArray(svc.depends_on) ? svc.depends_on : Object.keys(svc.depends_on ?? {});
    const summary = {
      name,
      image: svc.image ?? null,
      build: Boolean(svc.build),
      profiles: svcProfiles,
      health: healthState(svc),
      dependsOn,
      restart: svc.restart ?? null,
      ports,
      expose: (svc.expose ?? []).map(String),
    };
    services.push(summary);

    for (const port of ports) {
      if (LOOPBACK.has(port.hostIp)) continue;
      const category = classifyPort(name, svc, port.target);
      if (!category) continue;
      const bind = port.hostIp || '0.0.0.0';
      const hostPort = port.published || '(random)';
      findings.push({
        service: name,
        category,
        bind,
        published: port.published,
        target: port.target,
        protocol: port.protocol,
        message: `${name} publishes ${category} port ${bind}:${hostPort}->${port.target}/${port.protocol} to every network interface`,
        fix:
          `Drop the ports entry and use expose: ["${port.target}"] if only other containers need it, ` +
          `or bind it to localhost: "127.0.0.1:${port.published || port.target}:${port.target}".`,
      });
    }
  }

  const noHealth = services.filter((s) => s.health === 'none' && s.ports.length > 0).map((s) => s.name);
  return { project: config?.name ?? null, services, profiles: [...profiles].sort(), findings, noHealth };
}

/** Compose files in `root`: the first primary file plus any override file. */
export function findComposeFiles(root) {
  const primary = COMPOSE_PRIMARY.find((f) => existsSync(path.join(root, f)));
  if (!primary) return [];
  const overrides = COMPOSE_OVERRIDES.filter((f) => existsSync(path.join(root, f)));
  return [primary, ...overrides];
}

/** Args for `docker compose ... config`. Files are relative to root. */
export function composeConfigArgs(files, { envResolution = false } = {}) {
  const args = ['compose'];
  for (const f of files) args.push('-f', f);
  args.push('--profile', '*', 'config', '--format', 'json', '--no-interpolate');
  if (!envResolution) args.push('--no-env-resolution');
  return args;
}

/** One safe line of docker's stderr: first line, `KEY=value` masked, capped. */
export function safeErrorLine(stderr) {
  const first =
    String(stderr ?? '')
      .trim()
      .split(/\r?\n/)[0] ?? '';
  return first.replace(/=\S+/g, '=***').slice(0, 200);
}

function runComposeConfig(root, files, docker) {
  const opts = { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    return execFileSync(docker, composeConfigArgs(files), opts);
  } catch (e) {
    // Older Compose releases lack --no-env-resolution. Retry without it; the
    // environment block is still dropped before anything is printed.
    if (/no-env-resolution/.test(String(e.stderr))) {
      return execFileSync(docker, composeConfigArgs(files, { envResolution: true }), opts);
    }
    throw e;
  }
}

const HELP = `stack-inspect ${VERSION} — describe a Docker Compose stack and flag risky ports

Usage: node stack-inspect.js [options]

  --root <dir>        Project folder (default: current folder)
  -f, --file <file>   Compose file (repeat for several; default: auto-detect)
  --input <file|->    Read a rendered config JSON instead of calling docker
  --json              Print a JSON summary on stdout
  --dry-run           Print the docker command and exit
  --debug             Write a trace to <out-dir>/stack-inspect.jsonl
  --out-dir <dir>     Trace folder (default: .topia/stack)
  --smoke             Check that docker compose is installed
  --help, --version

Never prints environment values.
Exit: 0 clean, 1 docker failed, 2 usage error, 3 no compose file, 5 port findings.`;

function renderText(summary, files) {
  const lines = [];
  if (files.length) lines.push(`compose files: ${files.join(', ')}`);
  if (summary.project) lines.push(`project: ${summary.project}`);
  lines.push(`profiles: ${summary.profiles.length ? summary.profiles.join(', ') : '(none)'}`);
  lines.push(`services (${summary.services.length}):`);
  for (const s of summary.services) {
    const ports = s.ports.map((p) => `${p.hostIp || '0.0.0.0'}:${p.published || '?'}->${p.target}/${p.protocol}`);
    const bits = [
      s.build ? 'build' : `image ${s.image ?? '?'}`,
      `health ${s.health}`,
      s.profiles.length ? `profiles ${s.profiles.join('|')}` : null,
      s.dependsOn.length ? `needs ${s.dependsOn.join('|')}` : null,
      ports.length ? `ports ${ports.join(' ')}` : null,
    ].filter(Boolean);
    lines.push(`  ${s.name}: ${bits.join('; ')}`);
  }
  if (summary.noHealth.length) lines.push(`no healthcheck in compose: ${summary.noHealth.join(', ')}`);
  if (summary.findings.length) {
    lines.push(`port findings (${summary.findings.length}):`);
    for (const f of summary.findings) lines.push(`  WARN ${f.message}. ${f.fix}`);
  } else {
    lines.push('port findings: none');
  }
  return lines.join('\n');
}

/**
 * CLI entry. Returns the exit code.
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, readStdin?: () => string, docker?: string }} io
 */
export async function main(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  const docker = io.docker ?? process.env.STACK_DOCKER ?? 'docker';

  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        root: { type: 'string' },
        file: { type: 'string', short: 'f', multiple: true },
        input: { type: 'string' },
        json: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        debug: { type: 'boolean', default: false },
        'out-dir': { type: 'string' },
        smoke: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (e) {
    err(`stack-inspect: ${e.message}`);
    err('Run with --help for usage.');
    return EXIT.USAGE;
  }

  if (values.help) {
    out(HELP);
    return EXIT.OK;
  }
  if (values.version) {
    out(VERSION);
    return EXIT.OK;
  }
  if (values.smoke) {
    try {
      const v = execFileSync(docker, ['compose', 'version', '--short'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      err(`stack-inspect: ok (docker compose ${v.trim()})`);
      return EXIT.OK;
    } catch {
      err(
        'stack-inspect: `docker compose` not found. Install Docker Desktop (macOS/Windows) or the docker-compose-plugin package (Linux).',
      );
      return EXIT.DOCKER_FAILED;
    }
  }

  const root = path.resolve(values.root ?? process.cwd());
  const trace = [];
  const note = (event, data = {}) => trace.push({ ts: new Date().toISOString(), event, ...data });

  let config;
  let files = [];
  if (values.input) {
    const raw =
      values.input === '-'
        ? (io.readStdin ?? (() => readFileSync(0, 'utf8')))()
        : readFileSync(path.resolve(root, values.input), 'utf8');
    try {
      config = JSON.parse(raw);
    } catch {
      err('stack-inspect: --input is not valid JSON.');
      return EXIT.USAGE;
    }
    note('input', { source: values.input === '-' ? 'stdin' : 'file' });
  } else {
    files = values.file?.length ? values.file : findComposeFiles(root);
    const missingFile = files.find((f) => !existsSync(path.resolve(root, f)));
    if (files.length === 0 || missingFile) {
      err(
        missingFile
          ? `stack-inspect: compose file not found: ${missingFile}`
          : `stack-inspect: no compose file in ${root} (looked for ${COMPOSE_PRIMARY.join(', ')}).`,
      );
      return EXIT.NOT_FOUND;
    }
    if (values['dry-run']) {
      out(`${docker} ${composeConfigArgs(files).join(' ')}`);
      return EXIT.OK;
    }
    try {
      config = JSON.parse(runComposeConfig(root, files, docker));
    } catch (e) {
      const detail = e.code === 'ENOENT' ? 'docker not found on PATH' : safeErrorLine(e.stderr) || e.message;
      err(`stack-inspect: docker compose config failed: ${detail}`);
      return EXIT.DOCKER_FAILED;
    }
    note('rendered', { files });
  }

  const summary = summarize(config);
  const code = summary.findings.length > 0 ? EXIT.FINDINGS : EXIT.OK;
  note('summary', { services: summary.services.length, findings: summary.findings.length, exit: code });

  if (values.debug) {
    const dir = resolveOutDir(root, values['out-dir']);
    mkdirSync(dir, { recursive: true });
    const tracePath = path.join(dir, 'stack-inspect.jsonl');
    appendFileSync(tracePath, `${trace.map((t) => JSON.stringify(t)).join('\n')}\n`, 'utf8');
    err(`stack-inspect: trace written to ${tracePath}`);
  }

  if (values.json) out(JSON.stringify({ version: VERSION, files, ...summary, exit: code }, null, 2));
  else out(renderText(summary, files));
  return code;
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`stack-inspect: ${e.message}\n`);
      process.exitCode = 1;
    },
  );
}
