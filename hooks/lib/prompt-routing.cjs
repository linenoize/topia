/**
 * prompt-routing.cjs — which Topia skills a prompt's wording points at.
 *
 * The Node twin of mods/lib/prompt-routing.ts `predict`, for the intent-router
 * hook: same table (skill-routes.json, generated with the mod's from
 * compiler/lib/intent-keywords.js), same scoring. A keyword is 3 points a word,
 * an L1 orchestrator 1 more, a skill named outright (/topia-debug, topia:debug)
 * wins; whole words only, with plain endings. A Node test holds the two to the
 * same answers.
 */
'use strict';

const ROUTES = require('./skill-routes.json');

const MAX_SKILLS = 3;
const MAX_CHARS = 8000;
const MIN_SCORE = 3;
const KEYWORD_SCORE = 3;
const EXPLICIT_SCORE = 100;

const BY_NAME = new Map(ROUTES.map((route) => [route.name, route]));

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordPattern(keyword) {
  const words = keyword.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  const suffix = /[a-z]$/i.test(keyword) ? '(?:s|es|ed|d|ing)?' : '';
  return new RegExp(`(?<![\\w-])${words}${suffix}(?![\\w-])`, 'gi');
}

const PATTERNS = ROUTES.flatMap((route) =>
  route.keywords.map((keyword) => ({ name: route.name, keyword, pattern: keywordPattern(keyword) })),
);

const EXPLICIT = /(?:\/topia[-:]|\/topia\s+|(?<![\w-])topia:)([a-z][\w-]*)/gi;

function layerRank(name) {
  return Number(BY_NAME.get(name)?.layer.replace(/\D/g, '') || 9);
}

function dropOverlaps(matches) {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const match of sorted) {
    const last = kept[kept.length - 1];
    if (last === undefined || match.start >= last.end) kept.push(match);
  }
  return kept;
}

/**
 * @param {string} text
 * @returns {{ skills: Array<{ name: string, keywords: string[], isExplicit: boolean, score: number }>, chain: string[] }}
 */
function predict(text) {
  const read = String(text || '').slice(0, MAX_CHARS);
  const found = new Map();
  const entry = (name) => {
    if (!found.has(name)) found.set(name, { matches: [], isExplicit: false });
    return found.get(name);
  };

  for (const hit of read.matchAll(EXPLICIT)) {
    const name = (hit[1] || '').toLowerCase();
    if (!BY_NAME.has(name)) continue;
    const one = entry(name);
    one.isExplicit = true;
    one.matches.push({ start: hit.index, end: hit.index + hit[0].length, keyword: `topia:${name}` });
  }

  for (const { name, keyword, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const hit of read.matchAll(pattern)) {
      entry(name).matches.push({ start: hit.index, end: hit.index + hit[0].length, keyword });
    }
  }

  const scored = [];
  for (const [name, one] of found) {
    const matches = dropOverlaps(one.matches);
    const keywords = [...new Set(matches.map((match) => match.keyword))];
    const words = keywords.reduce((sum, keyword) => sum + keyword.split(/\s+/).length, 0);
    let score = one.isExplicit ? EXPLICIT_SCORE : words * KEYWORD_SCORE;
    if (score > 0 && BY_NAME.get(name)?.layer === 'L1') score += 1;
    if (score >= MIN_SCORE) scored.push({ name, keywords, isExplicit: one.isExplicit, score });
  }

  scored.sort((a, b) => b.score - a.score || layerRank(a.name) - layerRank(b.name) || a.name.localeCompare(b.name));
  const skills = scored.slice(0, MAX_SKILLS);
  const shown = new Set(skills.map((skill) => skill.name));
  const top = skills[0];
  const chain = top === undefined ? [] : (BY_NAME.get(top.name)?.chain ?? []).filter((name) => !shown.has(name));

  return { skills, chain };
}

// The first line of the hook's suggestion; the prompt-routing mod drops the
// block by it where the mod draws the same reading itself.
const SUGGESTION_HEAD = '🧭 [Topia intent-router]';

/**
 * The suggestion the hook prints, or null when there is nothing to say: no
 * match, or the person already named the skill.
 * @param {ReturnType<typeof predict>} prediction
 * @returns {string | null}
 */
function formatSuggestion(prediction) {
  const [top, ...rest] = prediction.skills;
  if (top === undefined || top.isExplicit) return null;
  const route = BY_NAME.get(top.name);
  const words = top.keywords.map((keyword) => `"${keyword}"`).join(', ');
  const lines = [
    `${SUGGESTION_HEAD} Suggested: topia:${top.name} (${route.layer}, ${route.model}) — wording: ${words}`,
    `   Slash: /topia-${top.name} or /topia:${top.name}`,
  ];
  if (prediction.chain.length > 0) lines.push(`   Chain: ${[top.name, ...prediction.chain.slice(0, 4)].join(' → ')}`);
  if (rest.length > 0) lines.push(`   Also consider: ${rest.map((skill) => skill.name).join(', ')}`);
  lines.push('   Keyword reading only; skill-router decides the route.');
  return lines.join('\n');
}

module.exports = { predict, formatSuggestion, SUGGESTION_HEAD, MAX_SKILLS };
