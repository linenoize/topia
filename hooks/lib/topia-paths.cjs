/**
 * topia-paths.cjs — CJS mirror of compiler/lib/topia-paths.js (keep in sync).
 */

const {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} = require('node:fs');
const path = require('node:path');

const TOPIA_DIR = '.topia';
const LEGACY_TOPIA_DIR = '.Topia';
const INVARIANTS_BASENAME = 'INVARIANTS.md';
const LEGACY_INVARIANTS_BASENAME = 'invariants.md';
const INVARIANTS_REL_PATH = `${TOPIA_DIR}/${INVARIANTS_BASENAME}`;

const CONTEXT_POINTER_START = '<!-- @Topia-context-pointer:start -->';
const INVARIANTS_POINTER_START = '<!-- @Topia-invariants-pointer:start -->';

function resolveTopiaDir(root) {
  const canonical = path.join(root, TOPIA_DIR);
  const legacy = path.join(root, LEGACY_TOPIA_DIR);
  if (existsSync(canonical)) return canonical;
  if (existsSync(legacy)) return legacy;
  return canonical;
}

function topiaDirForWrite(root) {
  return path.join(root, TOPIA_DIR);
}

function invariantsPath(root) {
  return path.join(topiaDirForWrite(root), INVARIANTS_BASENAME);
}

function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

function resolveInvariantsFile(root) {
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

function renameDirCase(from, to) {
  try {
    renameSync(from, to);
  } catch {
    const tmp = `${to}-rename-tmp`;
    renameSync(from, tmp);
    renameSync(tmp, to);
  }
}

function normalizeTopiaDir(root, { dryRun = false } = {}) {
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

function auditTopiaPaths(root) {
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
    warnings.push(
      'Only legacy `.Topia/` found — run `topia onboard` or move state into `.topia/` (lowercase).',
    );
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
    if (names.includes(LEGACY_INVARIANTS_BASENAME) && !names.includes(INVARIANTS_BASENAME)) {
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
      /* skip */
    }
  }

  return { warnings };
}

module.exports = {
  TOPIA_DIR,
  LEGACY_TOPIA_DIR,
  INVARIANTS_BASENAME,
  LEGACY_INVARIANTS_BASENAME,
  INVARIANTS_REL_PATH,
  resolveTopiaDir,
  topiaDirForWrite,
  invariantsPath,
  resolveInvariantsFile,
  normalizeTopiaDir,
  auditTopiaPaths,
};
