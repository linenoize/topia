#!/usr/bin/env node
/**
 * env-sync.js — compare `.env` with `.env.example` by KEY NAME only.
 *
 * It never prints, logs or compares values. Values are read only so the
 * parser can skip the body of a multi-line quoted value; they are dropped
 * at once and never leave parseEnvKeys().
 *
 * Usage:
 *   node env-sync.js [--root <dir>] [--env <file>] [--example <file>]
 *                    [--json] [--fix [--yes]] [--dry-run] [--debug] [--out-dir <dir>]
 *
 * Exit codes (see ../references/exit-codes.md):
 *   0 every example key is in .env (extra keys are only reported)
 *   2 usage error
 *   3 example file not found
 *   5 keys missing from .env
 *
 * No dependencies. Node 18+.
 */

import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const VERSION = '0.1.0';
export const EXAMPLE_CANDIDATES = ['.env.example', '.env.sample', '.env.template', '.env.dist'];
export const EXIT = { OK: 0, USAGE: 2, NOT_FOUND: 3, MISSING: 5 };

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;

/** True when `text` holds an unescaped closing `quote`. */
function closesQuote(text, quote) {
  for (let i = 0; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === quote) return true;
  }
  return false;
}

/**
 * Read key names from dotenv text. Values are never returned.
 * @param {string} text
 * @returns {{ keys: string[], duplicates: string[], invalidLines: number[] }}
 */
export function parseEnvKeys(text) {
  const keys = [];
  const seen = new Set();
  const duplicates = new Set();
  const invalidLines = [];
  let openQuote = null;

  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (openQuote) {
      if (closesQuote(line, openQuote)) openQuote = null;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const match = KEY_LINE.exec(line);
    if (!match) {
      invalidLines.push(i + 1);
      continue;
    }
    const key = match[1];
    if (seen.has(key)) duplicates.add(key);
    else {
      seen.add(key);
      keys.push(key);
    }

    const rest = match[2].trimStart();
    const quote = rest[0];
    if ((quote === '"' || quote === "'" || quote === '`') && !closesQuote(rest.slice(1), quote)) {
      openQuote = quote;
    }
  }
  return { keys, duplicates: [...duplicates], invalidLines };
}

/**
 * @param {string[]} exampleKeys
 * @param {string[]} envKeys
 * @returns {{ missing: string[], extra: string[] }}
 */
export function compareKeys(exampleKeys, envKeys) {
  const inEnv = new Set(envKeys);
  const inExample = new Set(exampleKeys);
  return {
    missing: exampleKeys.filter((k) => !inEnv.has(k)),
    extra: envKeys.filter((k) => !inExample.has(k)),
  };
}

/** Pick the example file: explicit flag, else the first candidate that exists. */
export function resolveExamplePath(root, explicit) {
  if (explicit) return path.resolve(root, explicit);
  for (const name of EXAMPLE_CANDIDATES) {
    const candidate = path.join(root, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Compare two files. Returns key names and counts only.
 * @param {{ envPath: string, examplePath: string }} opts
 */
export function checkEnvFiles({ envPath, examplePath }) {
  const example = parseEnvKeys(readFileSync(examplePath, 'utf8'));
  const envExists = existsSync(envPath);
  const env = envExists ? parseEnvKeys(readFileSync(envPath, 'utf8')) : { keys: [], duplicates: [], invalidLines: [] };
  const { missing, extra } = compareKeys(example.keys, env.keys);
  return {
    envExists,
    exampleKeyCount: example.keys.length,
    envKeyCount: env.keys.length,
    missing,
    extra,
    duplicates: env.duplicates,
    invalidLines: env.invalidLines,
    exampleInvalidLines: example.invalidLines,
  };
}

/**
 * Append `KEY=` lines (empty values) for each missing key. Keeps the file's
 * line ending style and never rewrites existing lines.
 * @returns {string[]} the keys written
 */
export function appendMissingKeys(envPath, missing) {
  if (missing.length === 0) return [];
  let eol = '\n';
  let prefix = '';
  if (existsSync(envPath)) {
    if (!lstatSync(envPath).isFile()) throw new Error(`${envPath} is not a regular file`);
    const current = readFileSync(envPath, 'utf8');
    if (current.includes('\r\n')) eol = '\r\n';
    if (current.length > 0 && !current.endsWith('\n')) prefix = eol;
    if (current.length > 0) prefix += eol;
  }
  const body = [`# Added by env-sync. Fill in these values.`, ...missing.map((k) => `${k}=`)].join(eol) + eol;
  if (existsSync(envPath)) appendFileSync(envPath, prefix + body, 'utf8');
  else writeFileSync(envPath, body, 'utf8');
  return missing;
}

/** Artifact dir fallback order from the Topia script contract. */
export function resolveOutDir(root, flag, env = process.env) {
  if (flag) return path.resolve(root, flag);
  if (env.STACK_OUT_DIR) return path.resolve(env.STACK_OUT_DIR);
  if (env.OPENCLAW_OUTPUT_DIR) return path.resolve(env.OPENCLAW_OUTPUT_DIR);
  if (env.OPENCLAW_AGENT_DIR) return path.join(env.OPENCLAW_AGENT_DIR, 'artifacts', 'stack');
  if (env.OPENCLAW_STATE_DIR) return path.join(env.OPENCLAW_STATE_DIR, 'artifacts', 'stack');
  return path.join(root, '.topia', 'stack');
}

const HELP = `env-sync ${VERSION} — compare .env with .env.example by key name only

Usage: node env-sync.js [options]

  --root <dir>       Project folder (default: current folder)
  --env <file>       Env file to check (default: .env)
  --example <file>   Template file (default: first of ${EXAMPLE_CANDIDATES.join(', ')})
  --json             Print a JSON summary on stdout
  --fix              Append missing keys with empty values (asks first)
  --yes              Skip the question for --fix
  --dry-run          Show what --fix would add; write nothing
  --debug            Write a key-names-only trace to <out-dir>/env-sync.jsonl
  --out-dir <dir>    Trace folder (default: .topia/stack)
  --smoke            Check the runtime and exit
  --help, --version

Values are never printed, logged or compared.
Exit: 0 in sync, 2 usage error, 3 example file not found, 5 keys missing.`;

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/**
 * CLI entry. Returns the exit code; never calls process.exit itself.
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, isTTY?: boolean, confirm?: (q: string) => Promise<boolean> }} io
 */
export async function main(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  const isTTY = io.isTTY ?? Boolean(process.stdin.isTTY);
  const confirm = io.confirm ?? ask;

  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        root: { type: 'string' },
        env: { type: 'string', default: '.env' },
        example: { type: 'string' },
        json: { type: 'boolean', default: false },
        fix: { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false },
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
    err(`env-sync: ${e.message}`);
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
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 18) {
      err(`env-sync: Node ${process.versions.node} is too old. Install Node 18 or newer.`);
      return 1;
    }
    err(`env-sync: ok (Node ${process.versions.node})`);
    return EXIT.OK;
  }

  const root = path.resolve(values.root ?? process.cwd());
  const envPath = path.resolve(root, values.env);
  const examplePath = resolveExamplePath(root, values.example);
  if (!examplePath || !existsSync(examplePath)) {
    err(`env-sync: no example file found in ${root} (looked for ${values.example ?? EXAMPLE_CANDIDATES.join(', ')}).`);
    return EXIT.NOT_FOUND;
  }

  const trace = [];
  const note = (event, data = {}) => trace.push({ ts: new Date().toISOString(), event, ...data });
  note('start', { env: path.basename(envPath), example: path.basename(examplePath) });

  const result = checkEnvFiles({ envPath, examplePath });
  note('compared', { missing: result.missing, extra: result.extra, envExists: result.envExists });

  let written = [];
  let fixState = 'not-requested';
  if (values.fix && result.missing.length > 0) {
    if (values['dry-run']) {
      fixState = 'dry-run';
    } else if (!values.yes && !isTTY) {
      err('env-sync: --fix needs a terminal to ask, or pass --yes.');
      return EXIT.USAGE;
    } else {
      const ok =
        values.yes ||
        (await confirm(`Append ${result.missing.length} empty key(s) to ${path.basename(envPath)}? [y/N] `));
      if (ok) {
        written = appendMissingKeys(envPath, result.missing);
        fixState = 'written';
      } else {
        fixState = 'declined';
      }
    }
    note('fix', { state: fixState, keys: written });
  }

  const stillMissing = fixState === 'written' ? [] : result.missing;
  const code = stillMissing.length > 0 ? EXIT.MISSING : EXIT.OK;

  if (values.debug) {
    const dir = resolveOutDir(root, values['out-dir']);
    mkdirSync(dir, { recursive: true });
    const tracePath = path.join(dir, 'env-sync.jsonl');
    note('end', { exit: code });
    appendFileSync(tracePath, `${trace.map((t) => JSON.stringify(t)).join('\n')}\n`, 'utf8');
    err(`env-sync: trace written to ${tracePath}`);
  }

  const rel = (p) => path.relative(root, p) || p;
  if (values.json) {
    out(
      JSON.stringify(
        {
          version: VERSION,
          env: rel(envPath),
          example: rel(examplePath),
          envExists: result.envExists,
          inSync: stillMissing.length === 0,
          missing: result.missing,
          extra: result.extra,
          duplicates: result.duplicates,
          invalidLines: result.invalidLines,
          fix: fixState,
          added: written,
          exit: code,
        },
        null,
        2,
      ),
    );
    return code;
  }

  // Default mode: findings (or the written file path) on stdout, summary on stderr.
  if (fixState === 'written') {
    out(envPath);
  } else {
    for (const k of result.missing) out(`missing ${k}`);
  }
  for (const k of result.extra) out(`extra ${k}`);
  for (const k of result.duplicates) out(`duplicate ${k}`);
  for (const n of result.invalidLines) out(`unparsed-line ${n}`);

  if (!result.envExists) err(`env-sync: ${rel(envPath)} does not exist.`);
  if (fixState === 'dry-run')
    err(`env-sync: dry run. Would add ${result.missing.length} key(s): ${result.missing.join(', ')}`);
  if (fixState === 'written') err(`env-sync: added ${written.length} empty key(s). Fill in their values.`);
  if (fixState === 'declined') err('env-sync: nothing written.');
  err(
    `env-sync: ${rel(envPath)} vs ${rel(examplePath)} — ${result.missing.length} missing, ${result.extra.length} extra (keys only).`,
  );
  return code;
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`env-sync: ${e.message}\n`);
      process.exitCode = 1;
    },
  );
}

export const SCRIPT_PATH = fileURLToPath(import.meta.url);
