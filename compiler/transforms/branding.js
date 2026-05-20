/**
 * transforms/branding.js — appends Topia attribution to compiled output.
 *
 * Single source of truth for the footer string (BRANDING_FOOTER). Every
 * adapter imports this constant instead of hard-coding stats — if you bump
 * skill / synapse / pack counts, edit nexus-constants.js only.
 *
 * Footer convention: blank line, `---`, then markdown blockquote lines.
 * No HTML, no platform-specific markup — adapters wrap as needed.
 *
 * Public:
 *   BRANDING_FOOTER  (string)               canonical footer
 *   addBranding(body, adapter)              append footer if not already present
 */

import { BRANDING_FOOTER as NEXUS_FOOTER } from '../nexus-constants.js';

/** @deprecated Import from nexus-constants.js; kept for adapter imports */
export const BRANDING_FOOTER = NEXUS_FOOTER;

const DEFAULT_FOOTER = NEXUS_FOOTER;

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
