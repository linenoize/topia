import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..', 'skills');

const SIGNAL_NAME_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

/**
 * Signals that are intentionally emitted but not listened to within the mesh.
 * Covers external entry points + observability-only signals.
 */
export const INTENTIONAL_BROADCAST_SIGNALS = new Set([
  'output.density.set', // context-engine → orchestrators (dynamic consumption)
  'triage.classified', // review-intake → observability
  'agent.brief.ready', // review-intake → external issue tracker
  'outofscope.recorded', // idea/review-intake → observability
  'docs.updated', // docs → terminal output
  'audit.complete', // audit → terminal output
  'db.migrated', // db → terminal output
  'verification.complete', // verification → terminal output
  'architecture.shallow.flagged', // improve-architecture → terminal review output
  'architecture.deletion.passed', // improve-architecture → terminal review output
  'oracle.failed', // session-bridge → terminal output
  'invariants.seeded', // logic-guardian → terminal output
  'autopilot.downgraded', // legacy — kept as a no-op allowlist entry for back-compat in tests
]);

/**
 * Signals that are listened to but not emitted within the mesh.
 * Covers entry points fired by users / IDE events.
 */
export const EXTERNAL_TRIGGER_SIGNALS = new Set([
  'incident.detected', // incident → triggered by external monitoring alerts
  'business.context.loaded', // consulting-analysis entry point
  'marketing.campaign.start', // niche-finder entry point — fired by orchestrator/user
  'external.content.received', // quarantine entry point — fired by MCP/WebFetch/upload hooks
]);

/**
 * Parse the YAML frontmatter of a single SKILL.md file.
 *
 * @param {string} filePath
 * @returns {{ name: string, emit: string[], listen: string[] }}
 */
export function parseSignals(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: '', emit: [], listen: [] };

  const fm = match[1];
  const data = { name: '', emit: [], listen: [] };

  const nameMatch = fm.match(/^name:\s*(.*)$/m);
  if (nameMatch) data.name = nameMatch[1].trim();

  const emitMatch = fm.match(/^\s*emit:\s*(.*)$/m);
  if (emitMatch) {
    data.emit = emitMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const listenMatch = fm.match(/^\s*listen:\s*(.*)$/m);
  if (listenMatch) {
    data.listen = listenMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return data;
}

function scanSkills(dir) {
  const skills = {};
  if (!existsSync(dir)) return skills;
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillFile = join(dir, entry.name, 'SKILL.md');
      if (existsSync(skillFile)) {
        skills[entry.name] = parseSignals(skillFile);
      }
    }
  }

  return skills;
}

/**
 * Validate signal consistency across all skills in a directory.
 *
 * Returns:
 *   skillCount   — number of SKILL.md files scanned
 *   signalCount  — unique signals across emit + listen
 *   issues       — hard errors (orphan listeners, malformed names)
 *   warnings     — soft warnings (orphan emitters not on broadcast allowlist)
 *
 * @param {string} skillsDir
 * @returns {{ skillCount: number, signalCount: number, issues: string[], warnings: string[] }}
 */
export function validateSignals(skillsDir) {
  const coreSkills = scanSkills(skillsDir);
  const issues = [];
  const warnings = [];

  const allEmitted = new Set();
  const allListened = new Set();

  for (const data of Object.values(coreSkills)) {
    for (const signal of data.emit) allEmitted.add(signal);
    for (const signal of data.listen) allListened.add(signal);
  }

  // Naming check — both emit and listen must follow lowercase.dot.notation
  for (const [name, data] of Object.entries(coreSkills)) {
    for (const signal of [...data.emit, ...data.listen]) {
      if (!SIGNAL_NAME_PATTERN.test(signal)) {
        issues.push(
          `Skill "${name}" declares invalid signal name "${signal}" — must match lowercase.dot.notation`,
        );
      }
    }
  }

  // Orphan listeners — listen with no emitter (and not an external trigger)
  for (const [name, data] of Object.entries(coreSkills)) {
    for (const signal of data.listen) {
      if (!allEmitted.has(signal) && !EXTERNAL_TRIGGER_SIGNALS.has(signal)) {
        issues.push(`orphan listener: skill "${name}" listens to "${signal}", but nothing emits it.`);
      }
    }
  }

  // Orphan emitters — emit with no listener (and not on broadcast allowlist)
  for (const [name, data] of Object.entries(coreSkills)) {
    for (const signal of data.emit) {
      if (!allListened.has(signal) && !INTENTIONAL_BROADCAST_SIGNALS.has(signal)) {
        warnings.push(`orphan emitter: skill "${name}" emits "${signal}", but nothing listens.`);
      }
    }
  }

  const signalCount = new Set([...allEmitted, ...allListened]).size;
  const skillCount = Object.keys(coreSkills).length;

  return { skillCount, signalCount, issues, warnings };
}

// CLI execution
if (process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { issues, warnings } = validateSignals(SKILLS_DIR);

  for (const w of warnings) console.warn(`[signal-check] ${w}`);

  if (issues.length > 0) {
    console.error('\n✗ Signal Consistency Errors:');
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  } else {
    console.log('\n✓ Signal mesh is consistent.');
  }
}
