/**
 * Skill-invocation extraction for Topia metrics.
 *
 * A skill reaches the model three ways, and each leaves a different trace:
 *   1. Skill tool    — PostToolUse { tool_name: 'Skill', tool_input: { skill } }
 *   2. Subagent      — PostToolUse { tool_name: 'Agent' | 'Task',
 *                                    tool_input: { subagent_type: 'topia:x' } }
 *   3. Slash command — a user record in the transcript:
 *                        <command-name>/topia:x</command-name>
 *                      The skill body is expanded inline; no Skill tool runs.
 *
 * Before this module only (1) was counted, so slash commands and topia:*
 * subagents (most real usage) never reached skills.json.
 */
'use strict';

const { CATALOG } = require('./skill-catalog.cjs');

const TOPIA_NS = /^topia:/i;
const SKILL_LOAD_MARKER = 'Base directory for this skill';

/** Strip the `topia:` namespace; other plugins keep theirs (`remember:remember`). */
function normalizeSkillName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^\//, '').replace(TOPIA_NS, '');
}

/**
 * @param {object} hookData — PostToolUse stdin
 * @returns {{ skill: string, via: 'skill' | 'agent' } | null}
 */
function extractToolSkillInvocation(hookData = {}) {
  const tool = hookData.tool_name || hookData.tool || hookData.toolName || '';
  const input = hookData.tool_input || hookData.toolInput || {};
  if (!input || typeof input !== 'object') return null;

  if (tool === 'Skill') {
    const skill = normalizeSkillName(input.skill || input.name || input.command || '');
    return skill ? { skill, via: 'skill' } : null;
  }

  if (tool === 'Agent' || tool === 'Task') {
    // Only Topia's own agents are skills; general-purpose / Explore are not.
    const type = typeof input.subagent_type === 'string' ? input.subagent_type.trim() : '';
    if (!TOPIA_NS.test(type)) return null;
    const skill = normalizeSkillName(type);
    return skill ? { skill, via: 'agent' } : null;
  }

  return null;
}

const ALIASES = new Set(CATALOG.map((s) => s.slashAlias).filter(Boolean));

/**
 * Decide whether a slash command counts as a skill invocation.
 * @param {string} commandName — e.g. "/topia:audit", "/clear", "/impeccable"
 * @param {{ loadedSkill?: boolean }} [opts] — true when the next user record is
 *   the "Base directory for this skill" body, i.e. Claude Code loaded a skill.
 * @returns {string|null} skill name, or null when not a skill
 */
function slashCommandSkill(commandName, { loadedSkill = false } = {}) {
  const name = typeof commandName === 'string' ? commandName.trim().replace(/^\//, '') : '';
  if (!name) return null;
  const bare = name.replace(TOPIA_NS, '');
  // `/topia-audit` aliases tell the model to call the Skill tool, which the
  // PostToolUse path already counts. Counting the alias too would double it.
  if (ALIASES.has(bare)) return null;
  if (TOPIA_NS.test(name)) return bare || null;
  return loadedSkill ? name : null;
}

function userText(record) {
  const content = record?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

const COMMAND_NAME = /<command-name>\s*([^<\s]+)\s*<\/command-name>/;

/**
 * Pull slash-command skill invocations out of parsed transcript records.
 * @param {object[]} records — transcript JSONL records, in file order
 * @returns {{ skill: string, via: 'slash', ts: string|null }[]}
 */
function slashInvocationsFromRecords(records = []) {
  const out = [];
  let pending = null;
  const settle = (loadedSkill) => {
    if (!pending) return;
    const skill = slashCommandSkill(pending.name, { loadedSkill });
    if (skill) out.push({ skill, via: 'slash', ts: pending.ts });
    pending = null;
  };

  for (const rec of records) {
    if (!rec || rec.type !== 'user' || rec.isSidechain === true) continue;
    const text = userText(rec);
    const isSkillBody = text.trimStart().startsWith(SKILL_LOAD_MARKER);
    if (pending) settle(isSkillBody);
    // A skill body may quote <command-name> in its docs; it is never a command.
    if (!text || isSkillBody) continue;
    const m = text.match(COMMAND_NAME);
    if (m) pending = { name: m[1], ts: rec.timestamp || null };
  }
  settle(false);
  return out;
}

module.exports = {
  SKILL_LOAD_MARKER,
  normalizeSkillName,
  extractToolSkillInvocation,
  slashCommandSkill,
  slashInvocationsFromRecords,
};
