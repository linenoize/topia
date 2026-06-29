/**
 * Refresh the vendored agora-code tree from upstream, then re-apply Topia's
 * committed patches as the LAST step — failing loudly (non-zero exit) on any
 * rejected hunk. Replaces the manual `rsync` snippet that silently blew away
 * the Windows asyncio fix on every sync.
 *
 * Node (not rsync) so it runs on the Windows dev box. `git apply` re-applies
 * patches; `git` is a hard dependency.
 *
 *   node scripts/sync-agora-code.js           full sync (clone → copy → apply)
 *   node scripts/sync-agora-code.js --check    offline: reverse-check patches
 *                                              (confirms tree == upstream + patches)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGORA_DIR = path.resolve(HERE, '..', 'mcp-servers', 'agora-code');
const UPSTREAM = 'https://github.com/thebnbrkr/agora-code.git';

// Files/dirs mirrored from upstream. NOTICE-TOPIA.md and patches/ are NEVER in
// this set, so they always survive a sync.
const VENDORED = ['agora_code', 'LICENSE', 'pyproject.toml', 'pytest.ini', '.mcp.json', 'README.md', 'setup.sh'];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Apply (or, with check:true, reverse-check) every patches/*.patch in `dir`.
 * Throws loudly on the first rejected hunk — silent skip is the data-loss bug
 * this whole mechanism exists to retire.
 */
export function applyPatches({ dir = AGORA_DIR, check = false } = {}) {
  const patchesDir = path.join(dir, 'patches');
  if (!fs.existsSync(patchesDir)) return { applied: [] };
  const patches = fs
    .readdirSync(patchesDir)
    .filter((f) => f.endsWith('.patch'))
    .sort();
  const applied = [];
  for (const name of patches) {
    const patchPath = path.join(patchesDir, name);
    const args = check ? ['apply', '--reverse', '--check', patchPath] : ['apply', patchPath];
    try {
      execFileSync('git', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      const detail = err.stderr ? err.stderr.toString() : err.message;
      throw new Error(`agora-code patch ${check ? 'reverse-check' : 'apply'} failed: ${name}\n${detail}`);
    }
    applied.push(name);
  }
  return { applied };
}

/** Full sync: clone upstream → mirror vendored set → apply patches. */
export function sync() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-up-'));
  try {
    // Clone BEFORE touching the vendored tree — abort here leaves it untouched.
    git(['clone', '--depth', '1', UPSTREAM, tmp], os.tmpdir());
    for (const name of VENDORED) {
      const src = path.join(tmp, name);
      const dst = path.join(AGORA_DIR, name);
      if (!fs.existsSync(src)) continue;
      fs.rmSync(dst, { recursive: true, force: true }); // --delete semantics
      fs.cpSync(src, dst, { recursive: true });
    }
    applyPatches({ check: false }); // LAST step — fail loud on reject
    const sha = git(['rev-parse', '--short', 'HEAD'], tmp).trim();
    console.log(`✓ agora-code synced from upstream ${sha}.`);
    console.log('  Update NOTICE-TOPIA.md "Vendored on" date + record this SHA.');
    return { sha };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main(argv) {
  if (argv.includes('--check')) {
    const { applied } = applyPatches({ check: true });
    console.log(`✓ agora-code: ${applied.length} patch(es) reverse-check clean (tree == upstream + patches).`);
    return;
  }
  sync();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
