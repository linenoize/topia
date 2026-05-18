#!/usr/bin/env node

/**
 * postinstall.js — printed after `npm install` completes.
 *
 * Plain `npm install` only installs Topia's own devDependencies (c8, biome).
 * It does NOT register the plugin with Claude Code, wire hooks, or install
 * the optional agora-code MCP. This script prints the one-shot command that
 * does the rest.
 *
 * Quiet in CI / when run as a transitive dep — we only print to a TTY.
 */

// Skip in CI or when not interactive.
if (!process.stdout.isTTY || process.env.CI) {
  process.exit(0);
}

// Skip when installed as a transitive dependency (npm sets INIT_CWD when
// `npm install` is run from another package's directory).
if (process.env.INIT_CWD && process.env.INIT_CWD !== process.cwd()) {
  process.exit(0);
}

const reset = '\x1b[0m';
const cyan = '\x1b[36m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';

console.log('');
console.log(`  ${bold}Topia dependencies installed.${reset}`);
console.log('');
console.log(`  ${dim}npm install only installed devDependencies. To finish setting up:${reset}`);
console.log('');
console.log(`    ${cyan}node compiler/bin/topia.js install${reset}`);
console.log('');
console.log(`  ${dim}That one command will:${reset}`);
console.log(`    ${dim}• check for rune-kit conflicts (offer migration if found)${reset}`);
console.log(`    ${dim}• register the plugin with Claude Code (claude plugin add .)${reset}`);
console.log(`    ${dim}• wire discipline hooks globally (preflight / sentinel / completion-gate / quarantine)${reset}`);
console.log(`    ${dim}• install agora-code MCP for persistent memory (if Python 3.10+ is present)${reset}`);
console.log(`    ${dim}• verify with topia doctor${reset}`);
console.log('');
console.log(`  ${dim}Then restart Claude Code and edit .topia/org/org.md to set team policies.${reset}`);
console.log(`  ${dim}See: docs/ORG-CONFIG.md${reset}`);
console.log('');
