/**
 * doctor.js — diagnostic + nexus integrity validator.
 *
 * Two public entry points:
 *
 *   runDoctor({ outputRoot, adapter, config, TopiaRoot }) → results
 *     Checks compiled platform output: config exists, output dir exists,
 *     skill files present, cross-references resolve, index file present,
 *     split-pack skill files exist, injection rules valid.
 *     Side effects: none (read-only).
 *
 *   checkNexusIntegrity(TopiaRoot) → results
 *     Walks every SKILL.md, validates the toolkit graph:
 *       1. Reciprocal synapses — every "Calls (outbound)" entry has a
 *          matching "Called By" in the target skill.
 *       2. Version maturity — skills with version ≥0.8 AND all required
 *          sections get flagged for promotion to 1.0.
 *       3. Required sections — Purpose, Constraints, Sharp Edges, Done When,
 *          Cost Profile.
 *       4. Frontmatter conformance — author, version, layer, model, group,
 *          tools present.
 *     Side effects: none.
 *
 *   formatNexusResults(results) / formatDoctorResults(results) → string
 *     Pretty-prints results for the CLI. No I/O.
 *
 *   checkNexusIntegrity / formatNexusResults — deprecated aliases (v1).
 *
 * Result shape (both entry points):
 *   { checks: [{ name, status, detail? }], warnings: string[],
 *     errors: string[], stats?: {...} }
 *
 * Doctor never modifies disk. If you need to FIX a finding, route to the
 * relevant skill (idea / journal / surgeon, etc.).
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePack, parseTemplate } from './parser.js';

/**
 * runDoctor — validate compiled platform output for a given adapter.
 *
 * Behaviour:
 *  - Skips gracefully when no `topia.config.json` exists (source-only mode).
 *  - Claude adapter is passthrough (no compiled dir to check) — early-returns
 *    after the config check.
 *  - Other adapters: verify outputDir exists, contains expected skill files,
 *    cross-refs resolve, index file present, split packs intact.
 *
 * @param {{outputRoot:string, adapter:object, config:object, TopiaRoot:string}} opts
 * @returns {Promise<{platform, checks, warnings, errors, healthy}>}
 */
export async function runDoctor({ outputRoot, adapter, config, TopiaRoot }) {
  const results = {
    platform: adapter.name,
    checks: [],
    warnings: [],
    errors: [],
    healthy: true,
  };

  // Check 1: Config exists (skip in CI / source-only mode)
  const configPath = path.join(outputRoot, 'topia.config.json');
  if (existsSync(configPath)) {
    results.checks.push({ name: 'Config file', status: 'pass' });
  } else if (config && Object.keys(config).length > 0) {
    // Config was passed but file doesn't exist on disk — real problem
    results.checks.push({ name: 'Config file', status: 'fail', detail: 'topia.config.json not found' });
    results.errors.push('topia.config.json not found. Run `Topia init` first.');
    results.healthy = false;
  } else {
    // No config at all (CI / fresh clone) — skip gracefully
    results.checks.push({ name: 'Config file', status: 'skip', detail: 'No config — source-only mode' });
  }

  // Check 2: Output directory exists
  if (adapter.name === 'claude') {
    results.checks.push({ name: 'Output directory', status: 'skip', detail: 'Claude Code uses source directly' });
    return results;
  }

  const outputDir = path.join(outputRoot, adapter.outputDir);
  if (existsSync(outputDir)) {
    results.checks.push({ name: 'Output directory', status: 'pass', detail: outputDir });
  } else {
    results.checks.push({ name: 'Output directory', status: 'fail', detail: `${outputDir} not found` });
    results.errors.push(`Output directory ${outputDir} not found. Run \`Topia build\` first.`);
    results.healthy = false;
    return results;
  }

  // Check 3: Count skill files
  const files = await readdir(outputDir);
  const skillFiles = files.filter((f) => f.startsWith('Topia-') && f !== `Topia-index${adapter.fileExtension}`);

  // Dynamic expected count: scan source skills/ directory
  const sourceSkillsDir = path.join(TopiaRoot, 'skills');
  let sourceSkillCount = 0;
  if (existsSync(sourceSkillsDir)) {
    const entries = await readdir(sourceSkillsDir, { withFileTypes: true });
    sourceSkillCount = entries.filter(
      (e) => e.isDirectory() && existsSync(path.join(sourceSkillsDir, e.name, 'SKILL.md')),
    ).length;
  }
  const expectedSkillCount = sourceSkillCount - (config.skills?.disabled?.length || 0);

  if (skillFiles.length >= expectedSkillCount) {
    results.checks.push({ name: 'Skill files', status: 'pass', detail: `${skillFiles.length}/${expectedSkillCount}` });
  } else {
    results.checks.push({
      name: 'Skill files',
      status: 'warn',
      detail: `${skillFiles.length}/${expectedSkillCount} present`,
    });
    results.warnings.push(`Expected ${expectedSkillCount} skill files, found ${skillFiles.length}`);
  }

  // Check 4: Cross-reference integrity
  const crossRefErrors = await checkCrossRefs(outputDir, skillFiles, adapter);
  if (crossRefErrors.length === 0) {
    results.checks.push({ name: 'Cross-references', status: 'pass' });
  } else {
    results.checks.push({ name: 'Cross-references', status: 'warn', detail: `${crossRefErrors.length} dangling` });
    results.warnings.push(...crossRefErrors);
  }

  // Check 5: Index file exists
  const indexFile = `Topia-index${adapter.fileExtension}`;
  if (files.includes(indexFile)) {
    results.checks.push({ name: 'Index file', status: 'pass' });
  } else {
    results.checks.push({ name: 'Index file', status: 'warn', detail: 'Missing index file' });
    results.warnings.push('Index file not found. Rebuild with `Topia build`.');
  }

  // Check 6: Disabled skills warning
  const disabled = config.skills?.disabled || [];
  if (disabled.length > 0) {
    results.warnings.push(`${disabled.length} skills disabled: ${disabled.join(', ')}`);
  }

  // Check 7: Split pack integrity (validate skill manifest files exist)
  const extensionsDir = path.join(TopiaRoot, 'extensions');
  if (existsSync(extensionsDir)) {
    const splitPackErrors = await checkSplitPacks(extensionsDir);
    if (splitPackErrors.length === 0) {
      results.checks.push({ name: 'Split packs', status: 'pass' });
    } else {
      results.checks.push({
        name: 'Split packs',
        status: 'fail',
        detail: `${splitPackErrors.length} missing skill files`,
      });
      results.errors.push(...splitPackErrors);
    }
  }

  // Check 8: Reference injection rule validation
  const injectionErrors = await checkInjectionRules(TopiaRoot, config);
  if (injectionErrors.length === 0) {
    results.checks.push({ name: 'Injection rules', status: 'pass' });
  } else {
    results.checks.push({
      name: 'Injection rules',
      status: 'warn',
      detail: `${injectionErrors.length} issues`,
    });
    results.warnings.push(...injectionErrors);
  }

  if (results.errors.length > 0) results.healthy = false;

  return results;
}

/**
 * Check that all cross-references in compiled files point to existing files
 */
async function checkCrossRefs(outputDir, files, adapter) {
  const errors = [];
  const fileSet = new Set(files);

  for (const file of files) {
    const content = await readFile(path.join(outputDir, file), 'utf-8');

    // Look for references to other Topia skills
    const refPattern = /Topia-([a-z][\w-]*)/g;
    let match;
    while ((match = refPattern.exec(content)) !== null) {
      const refName = match[1];
      const expectedFile = `Topia-${refName}${adapter.fileExtension}`;
      if (!fileSet.has(expectedFile) && refName !== 'index' && refName !== 'kit') {
        errors.push(`${file}: references Topia-${refName} but ${expectedFile} not found`);
      }
    }
  }

  return [...new Set(errors)]; // deduplicate
}

/**
 * Check that all split packs have their declared skill files present
 */
async function checkSplitPacks(extensionsDir) {
  const errors = [];
  const entries = await readdir(extensionsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packFile = path.join(extensionsDir, entry.name, 'PACK.md');
    if (!existsSync(packFile)) continue;

    const content = await readFile(packFile, 'utf-8');
    const parsed = parsePack(content, packFile);

    if (!parsed.isSplit) continue;

    const packDir = path.dirname(packFile);
    for (const skill of parsed.skillManifest) {
      const skillPath = path.join(packDir, skill.file);
      if (!existsSync(skillPath)) {
        errors.push(`@Topia/${entry.name}: skill file "${skill.file}" declared in manifest but not found`);
      }
    }
  }

  return errors;
}

/**
 * Check that inject.json rules reference existing files and valid skills.
 */
async function checkInjectionRules(TopiaRoot, _config) {
  const errors = [];
  const _parentDir = path.resolve(TopiaRoot, '..');

  // Collect known skill names from Free core
  const knownSkills = new Set();
  const skillsDir = path.join(TopiaRoot, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))) {
        knownSkills.add(entry.name);
      }
    }
  }

  // Scan extensions directory for inject.json files
  const extDir = path.join(TopiaRoot, 'extensions');

  if (existsSync(extDir)) {
    for (const packEntry of await readdir(extDir, { withFileTypes: true })) {
      if (!packEntry.isDirectory()) continue;
      const injectFile = path.join(extDir, packEntry.name, 'inject.json');
      if (!existsSync(injectFile)) continue;

      try {
        const raw = await readFile(injectFile, 'utf-8');
        const config = JSON.parse(raw);
        const packDir = path.join(extDir, packEntry.name);

        for (const rule of config.injections || []) {
          // Check target skill exists
          if (rule.skill && !knownSkills.has(rule.skill)) {
            errors.push(`${packEntry.name}/inject.json: target skill "${rule.skill}" not found in Free core`);
          }
          // Check reference file exists
          if (rule.ref) {
            const refPath = path.join(packDir, rule.ref);
            if (!existsSync(refPath)) {
              errors.push(`${packEntry.name}/inject.json: reference file "${rule.ref}" not found`);
            }
          }
        }
      } catch (e) {
        errors.push(`${packEntry.name}/inject.json: invalid JSON — ${e.message}`);
      }
    }
  }

  return errors;
}

/**
 * Check that template signal references exist in the skill ecosystem.
 * Scans templates/ in Pro/Business extension dirs (relative to TopiaRoot parent).
 */
async function _checkTemplateSignals(TopiaRoot, _config) {
  const errors = [];

  // Collect all known signals from core + pack skills
  const knownSignals = new Set();
  const skillsDir = path.join(TopiaRoot, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const content = await readFile(skillFile, 'utf-8');
      for (const signal of extractFrontmatterSignals(content)) {
        knownSignals.add(signal);
      }
    }
  }

  // Scan extensions directory for signals + templates
  const extDir = path.join(TopiaRoot, 'extensions');
  const templateFiles = [];

  if (existsSync(extDir)) {
    for (const packEntry of await readdir(extDir, { withFileTypes: true })) {
      if (!packEntry.isDirectory()) continue;
      const packDir = path.join(extDir, packEntry.name);

      // Collect signals from pack skills
      const packSkillsDir = path.join(packDir, 'skills');
      if (existsSync(packSkillsDir)) {
        for (const sf of await readdir(packSkillsDir)) {
          if (!sf.endsWith('.md')) continue;
          const content = await readFile(path.join(packSkillsDir, sf), 'utf-8');
          for (const signal of extractFrontmatterSignals(content)) {
            knownSignals.add(signal);
          }
        }
      }

      // Collect template files
      const templatesDir = path.join(packDir, 'templates');
      if (existsSync(templatesDir)) {
        for (const tf of await readdir(templatesDir)) {
          if (!tf.endsWith('.md')) continue;
          templateFiles.push(path.join(templatesDir, tf));
        }
      }
    }
  }

  // Validate each template's signals
  for (const templatePath of templateFiles) {
    const content = await readFile(templatePath, 'utf-8');
    const parsed = parseTemplate(content, templatePath);
    const templateName = parsed.name || path.basename(templatePath, '.md');

    for (const signal of parsed.signals.listen) {
      if (!knownSignals.has(signal)) {
        errors.push(`template "${templateName}": listens to "${signal}" but no skill emits it`);
      }
    }
  }

  return errors;
}

/**
 * Extract emit/listen signal names from a file's frontmatter
 */
function extractFrontmatterSignals(content) {
  const signals = [];
  const normalized = content.replace(/\r\n/g, '\n');
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return signals;

  const raw = fmMatch[1];
  for (const key of ['emit', 'listen']) {
    const match = raw.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
    if (match) {
      for (const s of match[1].split(',')) {
        const trimmed = s.trim();
        if (trimmed) signals.push(trimmed);
      }
    }
  }
  return signals;
}

/**
 * Check nexus integrity: reciprocal synapses, version suggestions, required sections
 *
 * @param {string} TopiaRoot - path to Topia source root
 * @returns {Promise<object>} nexus check results
 */
export async function checkNexusIntegrity(TopiaRoot) {
  const results = {
    checks: [],
    warnings: [],
    errors: [],
    stats: {
      skills: 0,
      synapses: 0,
      pulses: 0,
      pulseEdges: 0,
      missingReciprocals: 0,
      // deprecated v1 keys (mirrored at end)
      connections: 0,
      signals: 0,
      signalEdges: 0,
    },
  };

  const skillsDir = path.join(TopiaRoot, 'skills');
  if (!existsSync(skillsDir)) {
    results.errors.push('skills/ directory not found');
    return results;
  }

  // Step 1: Parse all skills
  const skills = new Map(); // name → { calls: [], calledBy: [], version, sections }
  const entries = await readdir(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;

    const content = await readFile(skillFile, 'utf-8');
    const parsed = parseSkillConnections(content, entry.name);
    skills.set(entry.name, parsed);
  }

  results.stats.skills = skills.size;

  // Step 2: Validate reciprocals
  const missingReciprocals = [];

  for (const [name, skill] of skills) {
    for (const called of skill.calls) {
      const targetSkill = skills.get(called.skill);
      if (!targetSkill) continue; // External skill or L4 pack

      // Check if target acknowledges this caller
      const acknowledges = targetSkill.calledBy.some((c) => c.skill === name);
      if (!acknowledges) {
        missingReciprocals.push({
          caller: name,
          callee: called.skill,
          reason: called.reason,
        });
      }
    }
    results.stats.synapses += skill.calls.length;
  }

  // Step 2.5: Count async pulses (emit/listen pairs) — separate from sync synapses
  const emitters = new Map(); // signal → Set<skill>
  const listeners = new Map(); // signal → Set<skill>
  for (const [name, skill] of skills) {
    for (const sig of skill.emit) {
      if (!emitters.has(sig)) emitters.set(sig, new Set());
      emitters.get(sig).add(name);
    }
    for (const sig of skill.listen) {
      if (!listeners.has(sig)) listeners.set(sig, new Set());
      listeners.get(sig).add(name);
    }
  }
  const allSignals = new Set([...emitters.keys(), ...listeners.keys()]);
  results.stats.pulses = allSignals.size;
  // Edges = sum over each pulse of (emitter_count × listener_count)
  let edges = 0;
  for (const sig of allSignals) {
    const emCount = emitters.get(sig)?.size || 0;
    const liCount = listeners.get(sig)?.size || 0;
    edges += emCount * liCount;
  }
  results.stats.pulseEdges = edges;

  // Deprecated v1 stat mirrors
  results.stats.connections = results.stats.synapses;
  results.stats.signals = results.stats.pulses;
  results.stats.signalEdges = results.stats.pulseEdges;

  results.stats.missingReciprocals = missingReciprocals.length;

  if (missingReciprocals.length === 0) {
    results.checks.push({ name: 'Reciprocal connections', status: 'pass' });
  } else {
    results.checks.push({
      name: 'Reciprocal connections',
      status: 'warn',
      detail: `${missingReciprocals.length} missing`,
    });
    // Group by callee for cleaner output
    const byCallee = {};
    for (const m of missingReciprocals) {
      if (!byCallee[m.callee]) byCallee[m.callee] = [];
      byCallee[m.callee].push(m.caller);
    }
    for (const [callee, callers] of Object.entries(byCallee)) {
      results.warnings.push(`${callee}: missing callers in Called By: ${callers.join(', ')}`);
    }
  }

  // Step 3: Check version maturity
  const matureButLow = [];
  for (const [name, skill] of skills) {
    if (!skill.version) continue;
    const [major, minor] = skill.version.split('.').map(Number);
    // Suggest 1.0 if version is 0.8+ and has all required sections
    if (major === 0 && minor >= 8 && skill.hasAllSections) {
      matureButLow.push({ name, version: skill.version });
    }
  }

  if (matureButLow.length === 0) {
    results.checks.push({ name: 'Version maturity', status: 'pass' });
  } else {
    results.checks.push({
      name: 'Version maturity',
      status: 'warn',
      detail: `${matureButLow.length} skills ready for 1.0`,
    });
    for (const s of matureButLow) {
      results.warnings.push(`${s.name} v${s.version}: mature skill, consider promoting to 1.0`);
    }
  }

  // Step 4: Check required sections
  const requiredSections = ['Purpose', 'Constraints', 'Sharp Edges', 'Done When', 'Cost Profile'];
  const missingSections = [];

  for (const [name, skill] of skills) {
    const missing = requiredSections.filter((s) => !skill.sections.includes(s));
    if (missing.length > 0) {
      missingSections.push({ name, missing });
    }
  }

  if (missingSections.length === 0) {
    results.checks.push({ name: 'Required sections', status: 'pass' });
  } else {
    results.checks.push({
      name: 'Required sections',
      status: 'warn',
      detail: `${missingSections.length} skills incomplete`,
    });
    for (const s of missingSections) {
      results.warnings.push(`${s.name}: missing sections: ${s.missing.join(', ')}`);
    }
  }

  // Step 5: Frontmatter conformance — every skill must declare the required metadata fields.
  const requiredFrontmatter = ['author', 'version', 'layer', 'model', 'group', 'tools'];
  const incompleteFrontmatter = [];

  for (const [name, skill] of skills) {
    const missing = requiredFrontmatter.filter((f) => !skill.frontmatter[f]);
    if (missing.length > 0) {
      incompleteFrontmatter.push({ name, missing });
    }
  }

  if (incompleteFrontmatter.length === 0) {
    results.checks.push({ name: 'Frontmatter conformance', status: 'pass' });
  } else {
    results.checks.push({
      name: 'Frontmatter conformance',
      status: 'warn',
      detail: `${incompleteFrontmatter.length} skills incomplete`,
    });
    for (const s of incompleteFrontmatter) {
      results.warnings.push(`${s.name}: missing frontmatter fields: ${s.missing.join(', ')}`);
    }
  }

  return results;
}

/**
 * Parse skill connections from SKILL.md content
 */
function parseSkillConnections(content, skillName) {
  const result = {
    name: skillName,
    calls: [],
    calledBy: [],
    version: null,
    sections: [],
    hasAllSections: false,
    emit: [],
    listen: [],
    frontmatter: {},
  };

  // Extract frontmatter block (everything between the first two `---` lines)
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fmBody = fmMatch[1];
    // Parse known top-level + metadata.* fields. Tolerant of indentation variants.
    const fields = ['author', 'version', 'layer', 'model', 'group', 'tools'];
    for (const f of fields) {
      const re = new RegExp(`^\\s*${f}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm');
      const m = fmBody.match(re);
      if (m) result.frontmatter[f] = m[1].trim();
    }
  }

  // Extract version from frontmatter (kept for back-compat with existing checks)
  const versionMatch = content.match(/version:\s*["']?([\d.]+)["']?/);
  if (versionMatch) {
    result.version = versionMatch[1];
  }

  // Extract emit/listen from frontmatter (comma-separated values on a single line)
  const emitMatch = content.match(/^\s*emit:\s*(.+)$/m);
  if (emitMatch) {
    result.emit = emitMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter((s) => s.length > 0);
  }
  const listenMatch = content.match(/^\s*listen:\s*(.+)$/m);
  if (listenMatch) {
    result.listen = listenMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter((s) => s.length > 0);
  }

  // Extract Calls section
  const callsMatch = content.match(/## Calls \(outbound\)\s*\n([\s\S]*?)(?=\n## |\n---|Z)/);
  if (callsMatch) {
    const lines = callsMatch[1].split('\n');
    for (const line of lines) {
      // Match patterns like: - `recon` (L2): scan codebase
      // Or: - recon (L2): scan codebase
      const match = line.match(/^-\s*`?([a-z][\w-]*)`?\s*\(L\d\)/i);
      if (match) {
        const skillRef = match[1].toLowerCase();
        const reason = line
          .replace(match[0], '')
          .replace(/^[:\s-]+/, '')
          .trim();
        result.calls.push({ skill: skillRef, reason });
      }
    }
  }

  // Extract Called By section
  const calledByMatch = content.match(/## Called By \(inbound\)\s*\n([\s\S]*?)(?=\n## |\n---|Z)/);
  if (calledByMatch) {
    const lines = calledByMatch[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^-\s*`?([a-z][\w-]*)`?\s*\(L\d\)/i);
      if (match) {
        const skillRef = match[1].toLowerCase();
        result.calledBy.push({ skill: skillRef });
      }
    }
  }

  // Check for required sections
  const sectionPatterns = [
    { name: 'Purpose', pattern: /## Purpose/ },
    { name: 'Constraints', pattern: /## Constraints/ },
    { name: 'Sharp Edges', pattern: /## Sharp Edges/ },
    { name: 'Done When', pattern: /## Done When/ },
    { name: 'Cost Profile', pattern: /## Cost Profile/ },
    { name: 'Returns', pattern: /## Returns/ },
  ];

  for (const { name, pattern } of sectionPatterns) {
    if (pattern.test(content)) {
      result.sections.push(name);
    }
  }

  result.hasAllSections = sectionPatterns.every(({ name }) => result.sections.includes(name));

  return result;
}

/**
 * Format nexus results for console output
 */
export function formatNexusResults(results) {
  const lines = [];
  lines.push(`\n  Nexus Integrity Check`);
  const pulseCount = results.stats.pulses ?? results.stats.signals ?? 0;
  const edges = results.stats.pulseEdges ?? results.stats.signalEdges ?? 0;
  const synapses = results.stats.synapses ?? results.stats.connections ?? 0;
  lines.push(`  Skills: ${results.stats.skills} | Synapses: ${synapses} | Pulses: ${pulseCount} (${edges} edges)`);
  lines.push('');

  for (const check of results.checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗';
    const detail = check.detail ? ` (${check.detail})` : '';
    lines.push(`  [${icon}] ${check.name}${detail}`);
  }

  if (results.warnings.length > 0) {
    lines.push('');
    for (const w of results.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }

  if (results.errors.length > 0) {
    lines.push('');
    for (const e of results.errors) {
      lines.push(`  ✗ ${e}`);
    }
  }

  const healthy = results.errors.length === 0 && results.warnings.length === 0;
  lines.push('');
  lines.push(healthy ? '  ✓ Nexus is healthy' : `  ! Nexus has ${results.warnings.length} warnings`);

  return lines.join('\n');
}

/** @deprecated Use checkNexusIntegrity */
export const checkMeshIntegrity = checkNexusIntegrity;

/** @deprecated Use formatNexusResults */
export const formatMeshResults = formatNexusResults;

/**
 * Format doctor results for console output
 */
export function formatDoctorResults(results) {
  const lines = [];
  lines.push(`\n  Platform: ${results.platform}`);

  for (const check of results.checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : check.status === 'skip' ? '–' : '✗';
    const detail = check.detail ? ` (${check.detail})` : '';
    lines.push(`  [${icon}] ${check.name}${detail}`);
  }

  if (results.warnings.length > 0) {
    lines.push('');
    for (const w of results.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }

  if (results.errors.length > 0) {
    lines.push('');
    for (const e of results.errors) {
      lines.push(`  ✗ ${e}`);
    }
  }

  lines.push('');
  lines.push(results.healthy ? '  ✓ Topia installation healthy' : '  ✗ Topia installation has issues');

  return lines.join('\n');
}
