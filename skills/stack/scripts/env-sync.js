#!/usr/bin/env node
/**
 * env-sync.js — compare `.env` with `.env.example` by KEY NAME only, and
 * optionally append the missing keys.
 *
 * It never prints, logs or compares values. Values in `.env` are read only so
 * the parser can skip the body of a multi-line quoted value and flag values a
 * shell cannot `source`; they never leave scanEnv(). `--fix` copies a missing
 * key's line and notes from `.env.example` (a committed file) into `.env`,
 * except for secret-named keys and placeholders, which are written empty.
 *
 * Usage:
 *   node env-sync.js [--root <dir>] [--env <file>] [--example <file>]
 *                    [--json] [--fix [--yes] [--empty] [--generate-secrets] [--no-backup]]
 *                    [--dry-run] [--debug] [--out-dir <dir>]
 *
 * Exit codes (see ../references/exit-codes.md):
 *   0 every example key is in .env (extra keys are only reported)
 *   2 usage error
 *   3 example file not found
 *   5 keys missing from .env
 *
 * No dependencies. Node 18+.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const VERSION = '0.2.0';
export const EXAMPLE_CANDIDATES = ['.env.example', '.env.sample', '.env.template', '.env.dist'];
export const EXIT = { OK: 0, USAGE: 2, NOT_FOUND: 3, MISSING: 5 };

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;
/** `# KEY=value` — a variable someone switched off. Prose such as `# Note: x` does not match. */
const COMMENTED_KEY_LINE = /^\s*#\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)=/;
/** Characters an unquoted value may hold and still be safe for `set -a; source .env`. */
const SHELL_SAFE_VALUE = /^[A-Za-z0-9_@%+=:,./#-]*$/;
/** Key names whose example value must not be copied: it is a placeholder or a shared secret. */
const SECRET_KEY = /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|_KEY$|^KEY$|SALT/i;
/** Example values that only say "put something here". */
const PLACEHOLDER =
  /^(?:|change[-_ ]?me|changeit|replace[-_ ]?me|todo|tbd|fixme|placeholder|example|xxx+|\*+|\.\.\.|<[^>]*>|\[[^\]]*\]|your[-_ ].*|.*[-_]here)$/i;

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

/** The value part with surrounding quotes and an inline ` # comment` removed (single-line values only). */
function bareValue(rest) {
  const v = rest.trim();
  const q = v[0];
  if ((q === '"' || q === "'" || q === '`') && v.length > 1 && v.endsWith(q)) return v.slice(1, -1);
  return v.replace(/\s+#.*$/, '');
}

/**
 * Read key names from dotenv text. Values are never returned.
 * @param {string} text
 * @returns {{ keys: string[], duplicates: string[], invalidLines: number[], commented: string[], needsQuotes: string[] }}
 */
export function scanEnv(text) {
  const keys = [];
  const seen = new Set();
  const duplicates = new Set();
  const invalidLines = [];
  const commented = new Set();
  const needsQuotes = new Set();
  let openQuote = null;

  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (openQuote) {
      if (closesQuote(line, openQuote)) openQuote = null;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) {
      const c = COMMENTED_KEY_LINE.exec(line);
      if (c) commented.add(c[1]);
      continue;
    }

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
    if (quote === '"' || quote === "'" || quote === '`') {
      if (!closesQuote(rest.slice(1), quote)) openQuote = quote;
      continue;
    }
    // Unquoted: a space, glob or shell character runs as a command under `source`.
    const unquoted = rest.replace(/\s+#.*$/, '').trimEnd();
    if (unquoted !== '' && !SHELL_SAFE_VALUE.test(unquoted)) needsQuotes.add(key);
  }
  return {
    keys,
    duplicates: [...duplicates],
    invalidLines,
    commented: [...commented].filter((k) => !seen.has(k)),
    needsQuotes: [...needsQuotes],
  };
}

/**
 * Read key names from dotenv text. Values are never returned.
 * @param {string} text
 * @returns {{ keys: string[], duplicates: string[], invalidLines: number[] }}
 */
export function parseEnvKeys(text) {
  const { keys, duplicates, invalidLines } = scanEnv(text);
  return { keys, duplicates, invalidLines };
}

/** True when a key name looks like it holds a secret. */
export const isSecretKey = (key) => SECRET_KEY.test(key);

/** True when an example value is a "fill me in" placeholder rather than a usable default. */
export const isPlaceholder = (value) => PLACEHOLDER.test(bareValue(value));

/**
 * Each example key's raw line(s) and the comment block right above it.
 * Keys that sit together under one comment block share a `group`, so the
 * notes are written once. For writing into .env only: never print the result.
 * @param {string} text
 * @returns {Map<string, { lines: string[], rest: string, notes: string[], group: number }>}
 */
export function exampleEntries(text) {
  const entries = new Map();
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  let notes = [];
  let groupNotes = [];
  let group = 0;
  let lastWasKey = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') {
      notes = [];
      lastWasKey = false;
      continue;
    }
    if (trimmed.startsWith('#')) {
      if (lastWasKey) notes = [];
      notes.push(line);
      lastWasKey = false;
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (!match) {
      notes = [];
      lastWasKey = false;
      continue;
    }
    if (!lastWasKey) {
      group++;
      groupNotes = notes;
    }
    const body = [line];
    const rest = match[2].trimStart();
    const quote = rest[0];
    if ((quote === '"' || quote === "'" || quote === '`') && !closesQuote(rest.slice(1), quote)) {
      while (i + 1 < lines.length) {
        i++;
        body.push(lines[i]);
        if (closesQuote(lines[i], quote)) break;
      }
    }
    if (!entries.has(match[1])) entries.set(match[1], { lines: body, rest, notes: groupNotes, group });
    lastWasKey = true;
  }
  return entries;
}

/**
 * What `--fix` would write for each missing key. `source` says where the
 * value came from: example (the .env.example line), empty (no default, or
 * --empty), secret (secret-named, left empty), placeholder (example value was
 * a placeholder, left empty) or generated (--generate-secrets).
 * Report only `key` and `source`; `lines` hold values.
 * @param {string | null} exampleText
 * @param {string[]} missing
 * @param {{ empty?: boolean, generateSecrets?: boolean, random?: () => string }} [opts]
 */
export function planAdditions(exampleText, missing, opts = {}) {
  const entries = exampleText == null ? new Map() : exampleEntries(exampleText);
  const random = opts.random ?? (() => randomBytes(32).toString('base64url'));
  return missing.map((key) => {
    const e = entries.get(key);
    const notes = e?.notes ?? [];
    const group = e?.group ?? -1;
    if (opts.generateSecrets && isSecretKey(key)) {
      return { key, source: 'generated', lines: [`${key}=${random()}`], notes, group };
    }
    if (!e || opts.empty) return { key, source: 'empty', lines: [`${key}=`], notes, group };
    if (isSecretKey(key)) return { key, source: 'secret', lines: [`${key}=`], notes, group };
    if (e.lines.length === 1 && isPlaceholder(e.rest)) {
      return { key, source: bareValue(e.rest) === '' ? 'empty' : 'placeholder', lines: [`${key}=`], notes, group };
    }
    return { key, source: 'example', lines: e.lines, notes, group };
  });
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
 * `missing` leaves out keys that .env has commented out (`# KEY=`): switching
 * one off may have been deliberate, so those are reported as `commentedOut`.
 * @param {{ envPath: string, examplePath: string }} opts
 */
export function checkEnvFiles({ envPath, examplePath }) {
  const example = scanEnv(readFileSync(examplePath, 'utf8'));
  const envExists = existsSync(envPath);
  const env = envExists
    ? scanEnv(readFileSync(envPath, 'utf8'))
    : { keys: [], duplicates: [], invalidLines: [], commented: [], needsQuotes: [] };
  const { missing: absent, extra } = compareKeys(example.keys, env.keys);
  const off = new Set(env.commented);
  return {
    envExists,
    exampleKeyCount: example.keys.length,
    envKeyCount: env.keys.length,
    missing: absent.filter((k) => !off.has(k)),
    commentedOut: absent.filter((k) => off.has(k)),
    extra,
    duplicates: env.duplicates,
    invalidLines: env.invalidLines,
    needsQuotes: env.needsQuotes,
    exampleInvalidLines: example.invalidLines,
  };
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Copy `.env` to `.env.bak-<timestamp>` (owner-only, never overwrites).
 * @returns {string | null} the backup path, or null when there was nothing to back up
 */
export function backupEnv(envPath, now = new Date()) {
  if (!existsSync(envPath)) return null;
  const base = `${envPath}.bak-${stamp(now)}`;
  for (let n = 0; n < 100; n++) {
    const target = n === 0 ? base : `${base}-${n}`;
    try {
      writeFileSync(target, readFileSync(envPath), { mode: 0o600, flag: 'wx' });
      return target;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error(`could not pick a free backup name next to ${envPath}`);
}

/** True when git would commit `file` (inside a work tree and not ignored). False outside git. */
export function wouldBeTracked(file, cwd) {
  const r = spawnSync('git', ['check-ignore', '-q', file], { cwd, encoding: 'utf8', windowsHide: true });
  return r.status === 1;
}

/**
 * Append missing keys. Keeps the file's line ending style and never rewrites
 * existing lines. With no `plan`, each key is written as an empty `KEY=`.
 * @param {string} envPath
 * @param {string[]} missing
 * @param {ReturnType<typeof planAdditions>} [plan]
 * @param {{ now?: Date, exampleName?: string }} [opts]
 * @returns {string[]} the keys written
 */
export function appendMissingKeys(envPath, missing, plan, opts = {}) {
  if (missing.length === 0) return [];
  const items = plan ?? planAdditions(null, missing);
  let eol = '\n';
  let prefix = '';
  if (existsSync(envPath)) {
    if (!lstatSync(envPath).isFile()) throw new Error(`${envPath} is not a regular file`);
    const current = readFileSync(envPath, 'utf8');
    if (current.includes('\r\n')) eol = '\r\n';
    if (current.length > 0 && !current.endsWith('\n')) prefix = eol;
    if (current.length > 0) prefix += eol;
  }
  const when = (opts.now ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  const out = [`# Added by env-sync ${when} from ${opts.exampleName ?? '.env.example'}. Review these values.`];
  let lastGroup = null;
  for (const item of items) {
    if (item.notes.length > 0 && item.group !== lastGroup) out.push('', ...item.notes);
    lastGroup = item.group;
    out.push(...item.lines);
  }
  const body = out.join(eol) + eol;
  if (existsSync(envPath)) appendFileSync(envPath, prefix + body, 'utf8');
  else writeFileSync(envPath, body, { encoding: 'utf8', mode: 0o600 });
  return items.map((i) => i.key);
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

  --root <dir>         Project folder (default: current folder)
  --env <file>         Env file to check (default: .env)
  --example <file>     Template file (default: first of ${EXAMPLE_CANDIDATES.join(', ')})
  --json               Print a JSON summary on stdout
  --fix                Append missing keys (asks first). Each gets its .env.example
                       line and the notes above it; secret-named keys and placeholders
                       are written empty. Backs up .env first.
  --yes                Skip the question for --fix
  --empty              With --fix: write every key empty (the 0.1 behaviour)
  --generate-secrets   With --fix: fill missing secret-named keys with a random
                       32-byte base64url value (written to .env, never printed)
  --no-backup          With --fix: skip the .env.bak-<timestamp> copy
  --dry-run            Show what --fix would add; write nothing
  --debug              Write a key-names-only trace to <out-dir>/env-sync.jsonl
  --out-dir <dir>      Trace folder (default: .topia/stack)
  --smoke              Check the runtime and exit
  --help, --version

Findings, one per line: missing KEY, commented KEY (only commented out in .env;
not added), extra KEY, duplicate KEY, needs-quotes KEY (unquoted value a shell
cannot source), unparsed-line N.
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

const SOURCE_LABEL = {
  example: 'default from example',
  empty: 'empty',
  secret: 'empty: secret',
  placeholder: 'empty: example had a placeholder',
  generated: 'generated',
};

/** `A (default from example), B (empty: secret)` — key names and sources only. */
export function describePlan(plan) {
  return plan.map((p) => `${p.key} (${SOURCE_LABEL[p.source]})`).join(', ');
}

/**
 * CLI entry. Returns the exit code; never calls process.exit itself.
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, isTTY?: boolean,
 *           confirm?: (q: string) => Promise<boolean>, now?: Date, random?: () => string }} io
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
        empty: { type: 'boolean', default: false },
        'generate-secrets': { type: 'boolean', default: false },
        'no-backup': { type: 'boolean', default: false },
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
  if ((values.empty || values['generate-secrets'] || values['no-backup']) && !values.fix) {
    err('env-sync: --empty, --generate-secrets and --no-backup only apply with --fix.');
    return EXIT.USAGE;
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
  note('compared', {
    missing: result.missing,
    commentedOut: result.commentedOut,
    extra: result.extra,
    envExists: result.envExists,
  });

  let written = [];
  let plan = [];
  let backup = null;
  let fixState = 'not-requested';
  if (values.fix && result.missing.length > 0) {
    plan = planAdditions(readFileSync(examplePath, 'utf8'), result.missing, {
      empty: values.empty,
      generateSecrets: values['generate-secrets'],
      random: io.random,
    });
    if (values['dry-run']) {
      fixState = 'dry-run';
    } else if (!values.yes && !isTTY) {
      err('env-sync: --fix needs a terminal to ask, or pass --yes.');
      return EXIT.USAGE;
    } else {
      const ok =
        values.yes ||
        (await confirm(
          `Append ${plan.length} key(s) to ${path.basename(envPath)}: ${describePlan(plan)}${
            result.envExists && !values['no-backup'] ? ' (backup first)' : ''
          }? [y/N] `,
        ));
      if (ok) {
        if (!values['no-backup']) backup = backupEnv(envPath, io.now);
        written = appendMissingKeys(envPath, result.missing, plan, {
          now: io.now,
          exampleName: path.basename(examplePath),
        });
        fixState = 'written';
      } else {
        fixState = 'declined';
      }
    }
    note('fix', {
      state: fixState,
      plan: plan.map((p) => ({ key: p.key, source: p.source })),
      backup: Boolean(backup),
    });
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
  const backupTracked = backup ? wouldBeTracked(backup, root) : false;
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
          commentedOut: result.commentedOut,
          extra: result.extra,
          duplicates: result.duplicates,
          needsQuotes: result.needsQuotes,
          invalidLines: result.invalidLines,
          fix: fixState,
          plan: plan.map((p) => ({ key: p.key, source: p.source })),
          added: written,
          backup: backup ? rel(backup) : null,
          backupTracked,
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
  for (const k of result.commentedOut) out(`commented ${k}`);
  for (const k of result.extra) out(`extra ${k}`);
  for (const k of result.duplicates) out(`duplicate ${k}`);
  for (const k of result.needsQuotes) out(`needs-quotes ${k}`);
  for (const n of result.invalidLines) out(`unparsed-line ${n}`);

  if (!result.envExists) err(`env-sync: ${rel(envPath)} does not exist.`);
  if (fixState === 'dry-run') err(`env-sync: dry run. Would add ${plan.length} key(s): ${describePlan(plan)}`);
  if (fixState === 'written') {
    err(`env-sync: added ${written.length} key(s): ${describePlan(plan)}. Review the values in ${rel(envPath)}.`);
    if (backup) err(`env-sync: backup at ${rel(backup)}.`);
    if (backupTracked) err(`env-sync: WARNING ${rel(backup)} is not gitignored. Add .env.bak-* to .gitignore.`);
  }
  if (fixState === 'declined') err('env-sync: nothing written.');
  if (result.commentedOut.length > 0)
    err(`env-sync: ${result.commentedOut.length} key(s) are only commented out in ${rel(envPath)}; left as they are.`);
  if (result.needsQuotes.length > 0)
    err(
      `env-sync: ${result.needsQuotes.length} unquoted value(s) would break \`source ${rel(envPath)}\`; wrap them in quotes.`,
    );
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
