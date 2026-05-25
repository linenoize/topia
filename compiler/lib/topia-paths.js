/**
 * topia-paths.js — Canonical `.topia/` path helpers (case-sensitive FS safe).
 *
 * Keep hooks/lib/topia-paths.cjs in sync for CJS hook consumers.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export const TOPIA_DIR = '.topia';
export const LEGACY_TOPIA_DIR = '.Topia';
export const INVARIANTS_BASENAME = 'INVARIANTS.md';
export const LEGACY_INVARIANTS_BASENAME = 'invariants.md';

export const INVARIANTS_REL_PATH = `${TOPIA_DIR}/${INVARIANTS_BASENAME}`;

const CONTEXT_POINTER_START = '<!-- @Topia-context-pointer:start -->';
const INVARIANTS_POINTER_START = '<!-- @Topia-invariants-pointer:start -->';

/**
 * Directory for reads: prefer `.topia/`, fall back to legacy `.Topia/` if only that exists.
 * @param {string} root — project root
 * @returns {string} absolute path to the resolved state directory
 */
export function resolveTopiaDir(root) {
  const canonical = path.join(root, TOPIA_DIR);
  const legacy = path.join(root, LEGACY_TOPIA_DIR);
  if (existsSync(canonical)) return canonical;
  if (existsSync(legacy)) return legacy;
  return canonical;
}

/**
 * Directory for writes: always `.topia/` (never create `.Topia/`).
 * @param {string} root
 * @returns {string}
 */
export function topiaDirForWrite(root) {
  return path.join(root, TOPIA_DIR);
}

/**
 * @param {string} root
 * @returns {string}
 */
export function invariantsPath(root) {
  return path.join(topiaDirForWrite(root), INVARIANTS_BASENAME);
}

/**
 * Resolve invariants file for reading (canonical name first, then legacy lowercase).
 * @param {string} root
 * @returns {{ path: string, found: boolean, legacy: boolean, dir: string }}
 */
function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

export function resolveInvariantsFile(root) {
  const dir = resolveTopiaDir(root);
  const canonical = path.join(dir, INVARIANTS_BASENAME);
  const legacy = path.join(dir, LEGACY_INVARIANTS_BASENAME);
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    names = [];
  }
  const hasExactCanonical = names.includes(INVARIANTS_BASENAME);
  const hasExactLegacy = names.includes(LEGACY_INVARIANTS_BASENAME);
  if (hasExactCanonical) {
    return { path: canonical, found: true, legacy: false, dir };
  }
  if (hasExactLegacy) {
    return { path: legacy, found: true, legacy: true, dir };
  }
  const hasCanonical = existsSync(canonical);
  const hasLegacy = existsSync(legacy);
  if (hasCanonical && hasLegacy && samePath(canonical, legacy)) {
    return { path: canonical, found: true, legacy: false, dir };
  }
  if (hasCanonical) {
    return { path: canonical, found: true, legacy: false, dir };
  }
  if (hasLegacy) {
    return { path: legacy, found: true, legacy: true, dir };
  }
  return {
    path: path.join(topiaDirForWrite(root), INVARIANTS_BASENAME),
    found: false,
    legacy: false,
    dir: topiaDirForWrite(root),
  };
}

/**
 * Map rune source filename to `.topia/` destination (normalizes invariants casing).
 * @param {string} runeFile — basename in `.rune/`
 * @returns {string}
 */
export function runeFileToTopiaDest(runeFile) {
  if (runeFile === LEGACY_INVARIANTS_BASENAME || runeFile === INVARIANTS_BASENAME) {
    return INVARIANTS_BASENAME;
  }
  return runeFile;
}

/**
 * Files to copy from `.rune/` (invariants variants collapse to one canonical dest).
 * @param {string[]} foundFiles — from detectRuneState
 * @returns {{ src: string, dest: string }[]}
 */
export function planRuneFileCopies(foundFiles) {
  const copies = [];
  let invariantsHandled = false;
  for (const file of foundFiles) {
    const dest = runeFileToTopiaDest(file);
    if (dest === INVARIANTS_BASENAME) {
      if (invariantsHandled) continue;
      invariantsHandled = true;
      const src = foundFiles.includes(INVARIANTS_BASENAME) ? INVARIANTS_BASENAME : LEGACY_INVARIANTS_BASENAME;
      copies.push({ src, dest: INVARIANTS_BASENAME });
      continue;
    }
    copies.push({ src: file, dest });
  }
  return copies;
}

/**
 * Copy files from `src` into `dest`, skipping paths that already exist in `dest`.
 * @param {string} src
 * @param {string} dest
 */
function mergeDirectoryInto(src, dest) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    const srcStat = statSync(srcPath);
    if (srcStat.isDirectory()) {
      if (existsSync(destPath) && statSync(destPath).isDirectory()) {
        mergeDirectoryInto(srcPath, destPath);
      } else if (!existsSync(destPath)) {
        cpSync(srcPath, destPath, { recursive: true });
      }
      continue;
    }
    if (!existsSync(destPath)) {
      cpSync(srcPath, destPath);
    }
  }
}

/**
 * Rename a directory when the only change is ASCII case (Windows-safe).
 * @param {string} from
 * @param {string} to
 */
function renameDirCase(from, to) {
  try {
    renameSync(from, to);
  } catch {
    const tmp = `${to}-rename-tmp`;
    renameSync(from, tmp);
    renameSync(tmp, to);
  }
}

/**
 * Normalize project state paths: merge or rename legacy `.Topia/` → `.topia/`,
 * and `invariants.md` → `INVARIANTS.md` when safe.
 * @param {string} root — project root
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ actions: string[], changed: boolean }}
 */
export function normalizeTopiaDir(root, { dryRun = false } = {}) {
  const actions = [];
  let rootNames = [];
  try {
    rootNames = readdirSync(root);
  } catch {
    return { actions, changed: false };
  }

  const hasExactTopia = rootNames.includes(TOPIA_DIR);
  const hasExactLegacyTopia = rootNames.includes(LEGACY_TOPIA_DIR);
  const canonicalDir = path.join(root, TOPIA_DIR);
  const legacyDir = path.join(root, LEGACY_TOPIA_DIR);

  if (hasExactTopia && hasExactLegacyTopia) {
    if (!dryRun) {
      mergeDirectoryInto(legacyDir, canonicalDir);
      rmSync(legacyDir, { recursive: true, force: true });
    }
    actions.push('merged `.Topia/` into `.topia/` and removed legacy directory');
  } else if (hasExactLegacyTopia && !hasExactTopia) {
    if (!dryRun) renameDirCase(legacyDir, canonicalDir);
    actions.push('renamed `.Topia/` to `.topia/`');
  }

  const stateDir = topiaDirForWrite(root);
  if (!existsSync(stateDir)) {
    return { actions, changed: actions.length > 0 };
  }

  let names = [];
  try {
    names = readdirSync(stateDir);
  } catch {
    return { actions, changed: actions.length > 0 };
  }

  if (names.includes(LEGACY_INVARIANTS_BASENAME) && !names.includes(INVARIANTS_BASENAME)) {
    const from = path.join(stateDir, LEGACY_INVARIANTS_BASENAME);
    const to = path.join(stateDir, INVARIANTS_BASENAME);
    if (!dryRun) renameSync(from, to);
    actions.push('renamed `invariants.md` to `INVARIANTS.md`');
  }

  return { actions, changed: actions.length > 0 };
}

/**
 * Audit project Topia paths for cross-platform issues.
 * @param {string} root — project root
 * @returns {{ warnings: string[] }}
 */
export function auditTopiaPaths(root) {
  const warnings = [];
  let rootNames = [];
  try {
    rootNames = readdirSync(root);
  } catch {
    rootNames = [];
  }
  const hasExactTopia = rootNames.includes(TOPIA_DIR);
  const hasExactLegacyTopia = rootNames.includes(LEGACY_TOPIA_DIR);
  const canonicalDir = path.join(root, TOPIA_DIR);
  const legacyDir = path.join(root, LEGACY_TOPIA_DIR);

  if (hasExactTopia && hasExactLegacyTopia) {
    warnings.push(
      'Both `.topia/` and legacy `.Topia/` exist — merge or remove `.Topia/` so state is not split on Linux.',
    );
  } else if (hasExactLegacyTopia && !hasExactTopia) {
    warnings.push('Only legacy `.Topia/` found — run `topia onboard` or move state into `.topia/` (lowercase).');
  }

  const readDir = hasExactTopia
    ? canonicalDir
    : hasExactLegacyTopia
      ? legacyDir
      : existsSync(canonicalDir)
        ? canonicalDir
        : existsSync(legacyDir)
          ? legacyDir
          : null;
  if (readDir) {
    let names = [];
    try {
      names = readdirSync(readDir);
    } catch {
      names = [];
    }
    const hasExactCanonical = names.includes(INVARIANTS_BASENAME);
    const hasExactLegacy = names.includes(LEGACY_INVARIANTS_BASENAME);
    if (hasExactLegacy && !hasExactCanonical) {
      warnings.push(
        'Only `.topia/invariants.md` found — run `topia onboard` or migrate to canonical `.topia/INVARIANTS.md`.',
      );
    }
  }

  const claudeMd = path.join(root, 'CLAUDE.md');
  if (existsSync(claudeMd)) {
    try {
      const content = readFileSync(claudeMd, 'utf8');
      if (!content.includes(INVARIANTS_POINTER_START)) {
        warnings.push('CLAUDE.md missing `@Topia-invariants-pointer` block — run `topia onboard`.');
      }
      if (!content.includes(CONTEXT_POINTER_START)) {
        warnings.push('CLAUDE.md missing `@Topia-context-pointer` block — run `topia onboard`.');
      }
    } catch {
      /* skip unreadable CLAUDE.md */
    }
  }

  return { warnings };
}

/**
 * Append Topia path audit warnings to doctor results (non-fatal).
 * @param {object} results — doctor result object
 * @param {string} projectRoot
 * @returns {object}
 */
export function appendTopiaPathChecks(results, projectRoot) {
  const { actions, changed } = normalizeTopiaDir(projectRoot);
  if (changed && actions.length > 0) {
    results.checks.push({
      name: 'Topia path normalization',
      status: 'pass',
      detail: actions.join('; '),
    });
  }

  const { warnings } = auditTopiaPaths(projectRoot);
  if (warnings.length === 0) {
    results.checks.push({ name: 'Topia state paths', status: 'pass' });
    return results;
  }
  results.checks.push({
    name: 'Topia state paths',
    status: 'warn',
    detail: `${warnings.length} cross-platform path issue(s)`,
  });
  for (const w of warnings) {
    results.warnings.push(w);
  }
  return results;
}
