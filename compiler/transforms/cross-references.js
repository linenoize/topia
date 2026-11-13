/**
 * Cross-Reference Transform
 *
 * Rewrites `topia:<name>` references to platform-native format.
 * Case-insensitive — legacy `topia:` references are still detected.
 *
 * Also rewrites sibling-skill file paths. Hidden Claude Code skills
 * (`disable-model-invocation: true`) cannot be called through the Skill tool,
 * so other skills point at their instructions file instead:
 * `${CLAUDE_SKILL_DIR}/../<name>/SKILL.md`. That variable only exists in
 * Claude Code, so other platforms get their own reference for `<name>`.
 */

const CROSS_REF_PATTERN = /`[Tt]opia:([a-z][\w-]*)`/g;
const BARE_REF_PATTERN = /(?<!`)[Tt]opia:([a-z][\w-]*)(?!`)/g;
const SKILL_FILE_PATTERN = /`\$\{CLAUDE_SKILL_DIR\}\/\.\.\/([a-z][\w-]*)\/SKILL\.md`/g;
const BARE_SKILL_FILE_PATTERN = /(?<!`)\$\{CLAUDE_SKILL_DIR\}\/\.\.\/([a-z][\w-]*)\/SKILL\.md(?!`)/g;

/**
 * Transform cross-references in skill body using the platform adapter
 *
 * @param {string} body - skill markdown body
 * @param {object} adapter - platform adapter with transformReference method
 * @returns {string} transformed body
 */
export function transformCrossReferences(body, adapter) {
  // Sibling skill files (`${CLAUDE_SKILL_DIR}/../build/SKILL.md`) → platform reference
  let result = body.replace(SKILL_FILE_PATTERN, (_match, skillName) => {
    return adapter.transformReference(skillName, `\`topia:${skillName}\``);
  });
  result = result.replace(BARE_SKILL_FILE_PATTERN, (_match, skillName) => {
    return adapter.transformReference(skillName, `topia:${skillName}`);
  });

  // Backtick-wrapped references (`topia:build`)
  result = result.replace(CROSS_REF_PATTERN, (match, skillName) => {
    return adapter.transformReference(skillName, match);
  });

  // Bare references (topia:build without backticks)
  result = result.replace(BARE_REF_PATTERN, (match, skillName) => {
    return adapter.transformReference(skillName, match);
  });

  return result;
}
