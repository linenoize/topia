/**
 * Cross-Reference Transform
 *
 * Rewrites `topia:<name>` references to platform-native format.
 * Case-insensitive — legacy `topia:` references are still detected.
 */

const CROSS_REF_PATTERN = /`[Tt]opia:([a-z][\w-]*)`/g;
const BARE_REF_PATTERN = /(?<!`)[Tt]opia:([a-z][\w-]*)(?!`)/g;

/**
 * Transform cross-references in skill body using the platform adapter
 *
 * @param {string} body - skill markdown body
 * @param {object} adapter - platform adapter with transformReference method
 * @returns {string} transformed body
 */
export function transformCrossReferences(body, adapter) {
  // First pass: backtick-wrapped references (`topia:build`)
  let result = body.replace(CROSS_REF_PATTERN, (match, skillName) => {
    return adapter.transformReference(skillName, match);
  });

  // Second pass: bare references (topia:build without backticks)
  result = result.replace(BARE_REF_PATTERN, (match, skillName) => {
    return adapter.transformReference(skillName, match);
  });

  return result;
}
