/**
 * nexus-constants.js — Single source of truth for Topia Nexus terminology and stats.
 *
 * Update counts here when skills/synapses/pulses/packs change.
 * These MUST match the live `topia doctor` computation — scripts/version-sync-check.js
 * fails the pre-publish gate if they drift, so this file can't silently rot again.
 */

export const NEXUS_STATS = {
  skills: 71,
  synapses: 315,
  pulses: 49,
  packs: 10,
};

export const BRANDING_TAGLINE = `Topia Nexus — ${NEXUS_STATS.skills} skills · ${NEXUS_STATS.synapses} synapses · ${NEXUS_STATS.pulses} pulses · ${NEXUS_STATS.packs} extension packs · optional agora-code MCP for persistent memory`;

export const BRANDING_REPO_URL = 'https://github.com/linenoize/topia';

/** Canonical footer lines (markdown blockquote). */
export const BRANDING_FOOTER_LINES = [
  '',
  '---',
  `> **${BRANDING_TAGLINE}**`,
  `> [github.com/linenoize/topia](${BRANDING_REPO_URL}) (MIT, internal)`,
];

export const BRANDING_FOOTER = BRANDING_FOOTER_LINES.join('\n');

/** Layer display labels for status output */
export const LAYER_EMOJI = {
  L0: '🎯',
  L1: '🚀',
  L2: '🏗️',
  L3: '🔧',
};
