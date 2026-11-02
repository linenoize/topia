#!/usr/bin/env node
/**
 * check-sf-skills-drift.mjs — report when forcedotcom/sf-skills has moved past our pin.
 *
 *   node scripts/check-sf-skills-drift.mjs              compare the pin against upstream main
 *   node scripts/check-sf-skills-drift.mjs --ref <ref>  compare against another ref
 *   node scripts/check-sf-skills-drift.mjs --pinned     re-hash each file at its pinned commit
 *
 * Manual only. It needs the network and `gh`, so it isn't part of CI. It never writes a file:
 * a person reads the upstream change and decides whether to port it, because upstream text is
 * data, and our rules win on conflict.
 *
 * Exit: 0 no drift, 1 drift, 2 a file couldn't be fetched or the pin is malformed.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN_FILE = path.join(ROOT, 'salesforce', 'upstream', 'sf-skills.json');

const SAFE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const SAFE_REF = /^[A-Za-z0-9._/-]+$/;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Throws on a pin that can't be trusted to drive a fetch. */
export function validatePin(pin) {
  if (!pin || typeof pin.repo !== 'string' || !Array.isArray(pin.sources) || pin.sources.length === 0) {
    throw new Error('Pin needs repo and a non-empty sources list.');
  }
  for (const source of pin.sources) {
    if (!SAFE_PATH.test(source.sourcePath ?? '') || source.sourcePath.includes('..')) {
      throw new Error(`Unsafe sourcePath in pin: ${source.sourcePath}`);
    }
    if (!/^[0-9a-f]{40}$/.test(source.sha ?? '')) throw new Error(`Bad sha for ${source.sourcePath}`);
    if (!/^[0-9a-f]{64}$/.test(source.sha256 ?? '')) throw new Error(`Bad sha256 for ${source.sourcePath}`);
  }
  return pin;
}

/**
 * Compare each pinned file with what `fetchFile(path, ref)` returns.
 * `fetchFile` returns bytes, or null when the file is gone, and throws when it can't tell.
 */
export function compareSources(pin, fetchFile, ref) {
  return pin.sources.map(source => {
    const target = ref ?? source.sha;
    try {
      const bytes = fetchFile(source.sourcePath, target);
      if (bytes === null) return { ...source, status: 'missing' };
      return { ...source, status: sha256(bytes) === source.sha256 ? 'same' : 'changed' };
    } catch (error) {
      return { ...source, status: 'error', error: error.message };
    }
  });
}

export function exitCodeFor(results) {
  if (results.some(result => result.status === 'error')) return 2;
  return results.some(result => result.status !== 'same') ? 1 : 0;
}

function ghFetcher(repo) {
  return (sourcePath, ref) => {
    try {
      return execFileSync(
        'gh',
        ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${sourcePath}?ref=${ref}`],
        { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      const stderr = error.stderr?.toString() ?? '';
      if (/HTTP 404|Not Found/i.test(stderr)) return null;
      throw new Error(stderr.trim() || error.message);
    }
  };
}

function parseArgs(argv) {
  const args = { ref: 'main', pinned: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ref') args.ref = argv[++i];
    else if (argv[i] === '--pinned') args.pinned = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!SAFE_REF.test(args.ref ?? '') || args.ref.startsWith('-')) throw new Error(`Unsafe ref: ${args.ref}`);
  return args;
}

function main() {
  let args;
  let pin;
  try {
    args = parseArgs(process.argv.slice(2));
    pin = validatePin(JSON.parse(readFileSync(PIN_FILE, 'utf-8')));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const ref = args.pinned ? undefined : args.ref;
  const results = compareSources(pin, ghFetcher(pin.repo), ref);
  for (const result of results) {
    console.log(`${result.status.padEnd(8)} ${result.sourcePath}${result.error ? ` (${result.error})` : ''}`);
    if (result.status === 'changed' || result.status === 'missing') {
      console.log(`         review: ${(result.portedInto ?? []).join(', ')}`);
    }
  }

  const code = exitCodeFor(results);
  const label = args.pinned ? 'pinned commit' : `ref ${args.ref}`;
  if (code === 0) console.log(`\nOK: ${results.length} files match the pin at ${label}.`);
  if (code === 1) console.log(`\nDRIFT at ${label}. Read the upstream change, then port by hand if it matters. Nothing was changed.`);
  if (code === 2) console.error('\nCould not check every file. Treat this as not checked.');
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
