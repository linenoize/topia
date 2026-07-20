/**
 * skill-catalog.js — enumerate Topia skills from skill directories
 *
 * Used by slash-alias generator, validation, and (via JSON emit) runtime hooks.
 * Scans skills/<name>/SKILL.md under the Topia root.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkill } from '../parser.js';

/** @typedef {{ name: string, description: string, model: string, layer: string, userInvocable: boolean, slashAlias: string }} SkillCatalogEntry */

const RESERVED_COMMANDS = new Set(['topia', 'finalize', 'org-config', 'migrate-from-rune']);

/**
 * @param {string} topiaRoot
 * @returns {SkillCatalogEntry[]}
 */
export function loadSkillCatalog(topiaRoot) {
  const skillsDir = join(topiaRoot, 'skills');
  if (!existsSync(skillsDir)) return [];

  const entries = [];

  for (const dirent of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;

    const skillPath = join(skillsDir, dirent.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;

    const content = readFileSync(skillPath, 'utf-8');
    const parsed = parseSkill(content, skillPath);
    const name = parsed.name || dirent.name;
    const userInvocable = parsed.frontmatter['user-invocable'] !== 'false';

    entries.push({
      name,
      description: parsed.description,
      model: parsed.model,
      layer: parsed.layer,
      userInvocable,
      slashAlias: `topia-${name}`,
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Bare `/design` style input — not `/topia-design` or `/topia:design`.
 * @param {string} prompt
 * @returns {string | null} skill name if bare Topia slash collision
 */
export function matchBareTopiaSlash(prompt, catalog) {
  const trimmed = prompt.trim();
  const match = trimmed.match(/^\/([a-z][\w-]*)$/);
  if (!match) return null;

  const slug = match[1];
  if (slug.startsWith('topia')) return null;
  if (RESERVED_COMMANDS.has(slug)) return null;

  const entry = catalog.find((s) => s.name === slug);
  return entry ? entry.name : null;
}

/**
 * @param {string} skillName
 * @param {SkillCatalogEntry[]} catalog
 */
export function formatBareSlashRedirect(skillName, catalog) {
  const entry = catalog.find((s) => s.name === skillName);
  const alias = entry?.slashAlias ?? `topia-${skillName}`;
  return (
    `[Topia] Bare \`/${skillName}\` is not a Topia command (avoids clashes with built-in slash commands). ` +
    `Use \`/${alias}\` or \`/topia:${skillName}\` or \`/topia ${skillName}\`.`
  );
}

export { RESERVED_COMMANDS };
