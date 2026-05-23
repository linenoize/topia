/**
 * synapse-tables.js — parse Calls/Called By sections from SKILL.md
 */

export function extractSynapseSkillsFromSection(sectionText) {
  if (!sectionText) return [];
  const out = [];
  for (const line of sectionText.split('\n')) {
    const bullet = line.match(/^-\s*`?([a-z][\w-]*)`?\s*\(L\d\)/i);
    if (bullet) {
      out.push(bullet[1].toLowerCase());
      continue;
    }
    const row = line.match(/^\|\s*`?([a-z][\w-]*)`?\s*\|/i);
    if (row) out.push(row[1].toLowerCase());
  }
  return [...new Set(out)];
}

export function extractSynapseEdgesFromSkill(content, sourceName) {
  const callsMatch = content.match(/## Calls \(outbound[^)]*\)([\s\S]*?)(?=\n## )/);
  const targets = extractSynapseSkillsFromSection(callsMatch ? callsMatch[1] : '');
  return targets
    .filter((t) => t !== sourceName)
    .map((target) => ({ source: sourceName, target, type: 'synapse' }));
}
