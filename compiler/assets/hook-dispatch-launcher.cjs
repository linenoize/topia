#!/usr/bin/env node
/**
 * Topia hook-dispatch launcher — a stable shim that survives plugin upgrades.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Claude Code does NOT expand `${CLAUDE_PLUGIN_ROOT}` inside user/project
 * `.claude/settings.json` hooks — it is only substituted for hooks declared in
 * a plugin's own bundled `hooks/hooks.json`
 * (https://code.claude.com/docs/en/hooks). And a marketplace-installed plugin
 * lives in a *versioned* cache directory
 * (`~/.claude/plugins/cache/<owner>/<plugin>/<version>/`) that Claude Code
 * replaces on every update. So a settings.json hook command that points straight
 * at the plugin's `compiler/bin/topia.js` rots the moment the plugin upgrades:
 *
 *   Error: Cannot find module
 *     '.../plugins/cache/linenoize/topia/3.1.1/compiler/bin/topia.js'
 *
 * This launcher is installed ONCE at a stable, version-independent path
 * (`<scope>/.claude/topia/hook-dispatch.cjs`) and is what settings.json points
 * at. Its only job: resolve the *current* plugin install and delegate to its
 * `compiler/bin/topia.js hook-dispatch …`.
 *
 * The anchor is the plugin manifest (`.claude-plugin/plugin.json`), NEVER a
 * cache directory name — cache names change on update and across namespace
 * migrations (linenoize → protopia, topia → skill-topia).
 *
 * Resolution order (fallback chain):
 *   1. CLAUDE_PLUGIN_ROOT / TOPIA_ROOT env, when actually set and valid.
 *   2. Walk up from this file for a `.claude-plugin/plugin.json` (covers the
 *      case where the launcher itself lives inside a plugin tree).
 *   3. Scan known install roots for the newest Topia plugin by manifest version.
 *
 * Fail-open: if the plugin cannot be located, exit 0 with a stderr note rather
 * than crash the session. A missing discipline gate must never block the user.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI_REL = path.join('compiler', 'bin', 'topia.js');
const MANIFEST_REL = path.join('.claude-plugin', 'plugin.json');
const PLUGIN_NAMES = new Set(['topia', 'skill-topia']);

function hasCli(root) {
  return Boolean(root) && fs.existsSync(path.join(root, CLI_REL));
}

/** Manifest version if `root` is a Topia plugin root, else null. */
function pluginVersion(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_REL), 'utf8'));
    if (manifest && typeof manifest.name === 'string' && PLUGIN_NAMES.has(manifest.name)) {
      return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    }
  } catch {
    /* not a manifest we recognize */
  }
  return null;
}

/** Compare semver-ish strings; >0 when `a` is newer. Non-numeric parts → 0. */
function cmpVersion(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < 3; i++) {
    const x = Number.parseInt(pa[i], 10);
    const y = Number.parseInt(pb[i], 10);
    const xi = Number.isFinite(x) ? x : 0;
    const yi = Number.isFinite(y) ? y : 0;
    if (xi !== yi) return xi - yi;
  }
  return 0;
}

/** Walk up from `startDir` to a plugin root identified by its manifest. */
function walkUpForManifest(startDir) {
  let dir = startDir;
  while (dir) {
    if (hasCli(dir) && pluginVersion(dir) !== null) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Bounded scan of known install roots for the newest Topia plugin. */
function scanForNewestPlugin() {
  const home = os.homedir();
  const bases = [
    path.join(home, '.claude', 'plugins', 'cache'),
    path.join(home, '.claude', 'plugins'),
    path.join(home, '.claude', 'skills'),
  ];
  const skip = new Set(['node_modules', '.git']);
  let best = null; // { root, version }
  let budget = 4000;

  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const stack = [{ dir: base, depth: 0 }];
    while (stack.length > 0 && budget-- > 0) {
      const { dir, depth } = stack.pop();
      const version = hasCli(dir) ? pluginVersion(dir) : null;
      if (version !== null) {
        if (!best || cmpVersion(version, best.version) > 0) best = { root: dir, version };
        continue; // do not descend into a resolved plugin root
      }
      if (depth >= 4) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || skip.has(entry.name)) continue;
        stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      }
    }
  }
  return best ? best.root : null;
}

function resolvePluginRoot() {
  for (const envRoot of [process.env.TOPIA_ROOT, process.env.CLAUDE_PLUGIN_ROOT]) {
    if (hasCli(envRoot)) return envRoot;
  }
  const fromSelf = walkUpForManifest(__dirname);
  if (fromSelf) return fromSelf;
  return scanForNewestPlugin();
}

function main() {
  const root = resolvePluginRoot();
  if (!root) {
    process.stderr.write(
      '[topia] hook-dispatch launcher could not locate the Topia plugin install.\n' +
        '        Re-run `/topia finalize` (or `topia setup`) to repair hooks.\n',
    );
    process.exit(0); // fail-open — never block the session
  }

  // settings.json passes `hook-dispatch <skill> [--gentle]`; forward verbatim.
  // Tolerate a command that omits the leading `hook-dispatch` token.
  const passed = process.argv.slice(2);
  const forwarded = passed[0] === 'hook-dispatch' ? passed : ['hook-dispatch', ...passed];

  const cli = path.join(root, CLI_REL);
  const result = spawnSync(process.execPath, [cli, ...forwarded], { stdio: 'inherit' });
  process.exit(result.status == null ? 0 : result.status);
}

main();
