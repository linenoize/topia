/**
 * session-report.cjs — format Topia session activity for Stop / sessionEnd hooks
 */

'use strict';

const { resolveSkillModel, getCatalog } = require('./skill-catalog.cjs');

function aggregateModelsByTier(skillCounts, pluginRoot) {
  const tiers = {};
  for (const [skill, count] of Object.entries(skillCounts)) {
    const tier = resolveSkillModel(skill, pluginRoot) || 'unknown';
    tiers[tier] = (tiers[tier] || 0) + count;
  }
  return tiers;
}

function formatTierSummary(tiers) {
  const order = ['opus', 'sonnet', 'haiku', 'unknown'];
  return order
    .filter((t) => tiers[t])
    .map((t) => `${t}:${tiers[t]}`)
    .join(' ');
}

function topTools(toolCounts, limit = 8) {
  return Object.entries(toolCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

/**
 * @param {{
 *   skillCounts: Record<string, number>,
 *   skillChain: string[],
 *   skillDurations: Record<string, number>,
 *   toolCounts: Record<string, number>,
 *   toolCalls: number,
 *   durationMin: number,
 *   primarySkill: string,
 *   skillInvocations: number,
 *   tokens?: object,
 * }} data
 * @param {string} [pluginRoot]
 */
function formatSessionReport(data, pluginRoot) {
  const {
    skillCounts,
    skillChain,
    skillDurations,
    toolCounts,
    toolCalls,
    durationMin,
    primarySkill,
    skillInvocations,
    tokens,
  } = data;

  const skillNames = Object.keys(skillCounts);
  if (skillNames.length === 0 && toolCalls === 0) {
    return null;
  }

  const tiers = aggregateModelsByTier(skillCounts, pluginRoot);
  const tierLine = formatTierSummary(tiers) || 'none';
  const skillTotal = skillInvocations || skillNames.reduce((n, k) => n + skillCounts[k], 0);

  const summary =
    `Topia · ${skillTotal} skill${skillTotal === 1 ? '' : 's'} · models ${tierLine} · ${toolCalls} tool${toolCalls === 1 ? '' : 's'}`;

  const skillLines = Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => {
      const tier = resolveSkillModel(name, pluginRoot) || '?';
      const dur = skillDurations[name];
      const durPart = dur != null ? `, ${Math.round(dur / 1000)}s` : '';
      return `- **${name}** ×${count} (${tier}${durPart})`;
    })
    .join('\n');

  const tools = topTools(toolCounts);
  const toolLines =
    tools.length > 0
      ? tools.map(([tool, count]) => `- ${tool}: ${count}`).join('\n')
      : '- (no tool counts recorded)';

  const chainLine =
    skillChain.length > 0 ? skillChain.join(' → ') : skillNames.join(', ') || 'none';

  const tokenNote =
    tokens?.confidence && tokens.confidence !== 'none'
      ? `\n- Est. tokens: ~${tokens.total_estimated} (peak ctx: ${tokens.context_peak ?? 'n/a'})`
      : '';

  const details = `<details>
<summary>Session activity</summary>

**Primary skill:** ${primarySkill} · **Duration:** ${durationMin} min

**Skill chain:** ${chainLine}

**Skills invoked**
${skillLines || '- none'}

**Tools (top)**
${toolLines}${tokenNote}

**Model tiers** are authoring hints (\`haiku\` / \`sonnet\` / \`opus\`). Your IDE resolves them to concrete model IDs (e.g. opus → current Claude Opus).

</details>`;

  return `${summary}\n\n${details}`;
}

module.exports = {
  aggregateModelsByTier,
  formatTierSummary,
  formatSessionReport,
  topTools,
  resolveSkillModel,
  getCatalog,
};
