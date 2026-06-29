/**
 * synapse-tables.js — parse Calls/Called By sections from SKILL.md
 */

const SKIP_TOKENS = new Set([
  'user',
  'any',
  'phase',
  'none',
  'optional',
  'ext',
  'l1',
  'l2',
  'l3',
  'l4',
  'sub-skill',
  'layer',
  'purpose',
  'skill',
  'when',
]);

/**
 * Extract a kebab-case skill name from a table cell or inline fragment.
 * @param {string} text
 * @returns {string | null}
 */
function extractSkillToken(text) {
  if (!text) return null;
  const backtick = text.match(/`([a-z][\w-]*)`/i);
  if (backtick) {
    const name = backtick[1].toLowerCase();
    return SKIP_TOKENS.has(name) ? null : name;
  }
  const plain = text.trim().match(/^([a-z][\w-]*)$/i);
  if (plain) {
    const name = plain[1].toLowerCase();
    return SKIP_TOKENS.has(name) ? null : name;
  }
  return null;
}

/**
 * @param {string} sectionText
 * @returns {boolean}
 */
function isPhaseTableSection(sectionText) {
  return sectionText.split('\n').some((line) => /^\|.*\bsub-skill\b/i.test(line));
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function splitTableCells(line) {
  return line
    .split('|')
    .map((cell) => cell.trim())
    .slice(1, -1);
}

export function extractSynapseSkillsFromSection(sectionText) {
  if (!sectionText) return [];
  const phaseTable = isPhaseTableSection(sectionText);
  const out = [];

  for (const line of sectionText.split('\n')) {
    if (line.startsWith('|')) {
      if (/^\|[\s\-:|]+\|/.test(line) && !line.match(/[a-z]/i)) continue;

      const cells = splitTableCells(line);
      if (cells.length === 0) continue;

      const skillCell = phaseTable ? cells[1] : cells[0];
      const skill = extractSkillToken(skillCell);
      if (skill) out.push(skill);
      continue;
    }

    const bulletLayer = line.match(/^-\s*`?([a-z][\w-]*)`?\s*\((?:L\d|ext)\)/i);
    if (bulletLayer) {
      const name = bulletLayer[1].toLowerCase();
      if (!SKIP_TOKENS.has(name)) out.push(name);
      continue;
    }

    const bulletPipe = line.match(/^-\s*`([a-z][\w-]*)`\s*\|/i);
    if (bulletPipe) {
      const name = bulletPipe[1].toLowerCase();
      if (!SKIP_TOKENS.has(name)) out.push(name);
    }
  }

  return [...new Set(out)];
}

export function extractSynapseEdgesFromSkill(content, sourceName) {
  const callsMatch = content.match(/## Calls \(outbound[^)]*\)([\s\S]*?)(?=\n## )/);
  const targets = extractSynapseSkillsFromSection(callsMatch ? callsMatch[1] : '');
  return targets.filter((t) => t !== sourceName).map((target) => ({ source: sourceName, target, type: 'synapse' }));
}
