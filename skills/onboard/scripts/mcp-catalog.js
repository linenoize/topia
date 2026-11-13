#!/usr/bin/env node
/**
 * Parked MCP servers and plugins: kept out of user scope so they don't load in
 * every session, and offered per project during onboard.
 *
 *   node mcp-catalog.js match --root <project>        JSON: entries that fit this project, and why
 *   node mcp-catalog.js list                          JSON: everything in the catalog
 *   node mcp-catalog.js apply --names rea,pencil      turn entries on for this project only (local scope)
 *   node mcp-catalog.js park <server> [--about "…"] [--signals "*.pen,design/"]
 *                                                     move a user-scope server into the catalog
 *
 * Catalog: ~/.claude/topia/mcp-catalog.json (TOPIA_MCP_CATALOG overrides). It lives in the
 * user's home, never in a repo. The claude CLI is run with an argument array, never through a
 * shell, so JSON and Windows paths reach it unchanged.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFAULT_CATALOG = path.join(os.homedir(), '.claude', 'topia', 'mcp-catalog.json');
const DEFAULT_USER_CONFIG = path.join(os.homedir(), '.claude.json');
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.venv',
  'venv',
  'vendor',
  '.topia',
  '.claude',
  '.next',
  'target',
]);
const TEXT_FILES = /^(readme(\.\w+)?|claude\.md|package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/i;
const MAX_FILES = 5000;
const MAX_DEPTH = 6;

export function catalogPath() {
  return process.env.TOPIA_MCP_CATALOG || DEFAULT_CATALOG;
}

export function readCatalog(file = catalogPath()) {
  if (!existsSync(file)) return { version: 1, servers: {}, plugins: {} };
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return { ...raw, version: raw.version ?? 1, servers: raw.servers ?? {}, plugins: raw.plugins ?? {} };
}

function writeCatalog(file, catalog) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
}

// File extensions, folder names and a little text from the project, bounded so a huge repo stays fast.
function scanProject(root) {
  const extensions = new Set();
  const folders = new Set();
  let text = '';
  let seen = 0;
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || seen > MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen++ > MAX_FILES) return;
      const name = entry.name.toLowerCase();
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        folders.add(name);
        walk(path.join(dir, entry.name), depth + 1);
      } else {
        const ext = path.extname(name);
        if (ext) extensions.add(ext);
        if (depth === 0 && TEXT_FILES.test(name)) {
          try {
            text += `\n${readFileSync(path.join(dir, entry.name), 'utf8').slice(0, 65536).toLowerCase()}`;
          } catch {
            // Unreadable: skip it.
          }
        }
      }
    }
  };
  walk(root, 0);
  return { extensions, folders, text };
}

function signalMatches(signal, scan) {
  const s = signal.toLowerCase();
  if (s.startsWith('*.')) return scan.extensions.has(s.slice(1));
  if (s.endsWith('/')) return scan.folders.has(s.slice(0, -1));
  // Whole words only: "spec" must not match "inspect" or "specific".
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(scan.text);
}

export function matchCatalog(catalog, root) {
  const scan = scanProject(root);
  const matches = [];
  const consider = (entries, kind) => {
    for (const [name, entry] of Object.entries(entries ?? {})) {
      const why = (entry.signals ?? []).filter((signal) => signalMatches(signal, scan));
      if (why.length > 0) matches.push({ name, kind, about: entry.about ?? '', why });
    }
  };
  consider(catalog.servers, 'server');
  consider(catalog.plugins, 'plugin');
  return matches;
}

function runClaude(args) {
  execFileSync('claude', args, { stdio: 'inherit' });
}

// Checks every name first, so a typo turns nothing on.
export function applyEntries(catalog, names, { run = runClaude } = {}) {
  const unknown = names.filter((name) => !catalog.servers?.[name] && !catalog.plugins?.[name]);
  if (unknown.length > 0) throw new Error(`Not in the catalog: ${unknown.join(', ')}`);
  for (const name of names) {
    if (catalog.servers?.[name]) {
      run(['mcp', 'add-json', name, JSON.stringify(catalog.servers[name].config), '-s', 'local']);
    } else {
      run(['plugin', 'enable', name, '--scope', 'local']);
    }
  }
  return names;
}

// Writes the catalog before removing anything, so a failure never loses a config.
export function parkServer(
  name,
  { catalogFile = catalogPath(), userConfig = DEFAULT_USER_CONFIG, run = runClaude, about = '', signals = [] } = {},
) {
  const config = JSON.parse(readFileSync(userConfig, 'utf8')).mcpServers?.[name];
  if (!config) throw new Error(`${name} is not an MCP server at user scope, so there is nothing to park.`);
  const catalog = readCatalog(catalogFile);
  const existing = catalog.servers[name] ?? {};
  catalog.servers[name] = {
    about: about || existing.about || '',
    signals: signals.length > 0 ? signals : (existing.signals ?? []),
    config,
  };
  writeCatalog(catalogFile, catalog);
  run(['mcp', 'remove', name, '-s', 'user']);
  return catalog.servers[name];
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: 'string', default: process.cwd() },
      names: { type: 'string', default: '' },
      about: { type: 'string', default: '' },
      signals: { type: 'string', default: '' },
    },
  });
  const [command, target] = positionals;
  const catalog = readCatalog();
  const list = (value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  if (command === 'match') {
    console.log(
      JSON.stringify({ catalog: catalogPath(), matches: matchCatalog(catalog, path.resolve(values.root)) }, null, 2),
    );
  } else if (command === 'list') {
    console.log(
      JSON.stringify(
        { catalog: catalogPath(), servers: Object.keys(catalog.servers), plugins: Object.keys(catalog.plugins) },
        null,
        2,
      ),
    );
  } else if (command === 'apply') {
    const applied = applyEntries(catalog, list(values.names));
    console.log(JSON.stringify({ applied }));
  } else if (command === 'park' && target) {
    parkServer(target, { about: values.about, signals: list(values.signals) });
    console.log(JSON.stringify({ parked: target, catalog: catalogPath() }));
  } else {
    console.error(
      'Usage: mcp-catalog.js match --root <dir> | list | apply --names a,b | park <server> [--about …] [--signals …]',
    );
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
