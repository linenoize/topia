/**
 * Branding Transform
 *
 * Adds Topia attribution footer to compiled skill files.
 * All adapters MUST import BRANDING_FOOTER instead of hardcoding stats.
 */

/**
 * Single source of truth for branding footer.
 * Update these numbers here — all adapters inherit automatically.
 */
export const BRANDING_FOOTER = [
  '',
  '---',
  '> **Topia Skill Mesh** — 65 skills · 203 connections · 44 signals · 10 extension packs · optional agora-code MCP for persistent memory',
  '> [github.com/linenoize/topia](https://github.com/linenoize/topia) (MIT, internal)',
].join('\n');

const DEFAULT_FOOTER = BRANDING_FOOTER;

/**
 * Add branding footer to skill output
 *
 * @param {string} body - transformed skill body
 * @param {object} adapter - platform adapter
 * @returns {string} body with footer
 */
export function addBranding(body, adapter) {
  if (adapter.name === 'claude') return body;

  const footer = adapter.generateFooter ? adapter.generateFooter() : DEFAULT_FOOTER;
  return `${body}\n${footer}`;
}
