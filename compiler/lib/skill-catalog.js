/**
 * skill-catalog.js — enumerate Topia skills from skill directories
 *
 * Used by the catalog generator, validation, and (via JSON emit) runtime hooks.
 * Scans skills/<name>/SKILL.md under the Topia root.
 *
 * Every skill is reached as `/topia:<name>` (the plugin namespace). There are
 * no generated `/topia-<name>` alias commands: they put each skill in the slash
 * menu twice.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseSkill } from '../parser.js';

/** @typedef {{ name: string, description: string, model: string, layer: string, userInvocable: boolean, userOnly: boolean, forked: boolean }} SkillCatalogEntry */

/** Hand-written commands in commands/. A bare `/<name>` for these is not redirected. */
const RESERVED_COMMANDS = new Set(['topia', 'finalize', 'migrate-from-rune']);

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
      // `disable-model-invocation: true`: Claude cannot start it; only a person typing /topia:<name> can.
      userOnly: parsed.frontmatter['disable-model-invocation'] === 'true',
      // `context: fork` — on Claude Code it runs as a subagent, in the background by default (2.1.218+).
      forked: parsed.contextFork === true,
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The slash names the plugin's commands/ directory adds, one per file: the
 * frontmatter `name` when set, else the file name.
 * @param {string} topiaRoot
 * @returns {{ name: string, file: string }[]}
 */
export function loadCommandNames(topiaRoot) {
  const commandsDir = join(topiaRoot, 'commands');
  if (!existsSync(commandsDir)) return [];

  const commands = [];
  for (const file of readdirSync(commandsDir)) {
    if (!file.endsWith('.md')) continue;
    const content = readFileSync(join(commandsDir, file), 'utf-8').replace(/\r\n/g, '\n');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    const named = frontmatter?.[1].match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m);
    commands.push({ name: named ? named[1] : basename(file, '.md'), file: `commands/${file}` });
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Slash names claimed by more than one skill or command. Each would show in
 * the slash menu twice. A `topia-<skill>` command counts as a claim on
 * `<skill>`: it is the old alias form, a second menu entry for the same skill.
 * @param {string} topiaRoot
 * @returns {{ name: string, sources: string[] }[]}
 */
export function findSlashCollisions(topiaRoot) {
  const claims = new Map();
  const claim = (name, source) => claims.set(name, [...(claims.get(name) ?? []), source]);

  const skills = loadSkillCatalog(topiaRoot);
  const skillNames = new Set(skills.map((s) => s.name));
  for (const skill of skills) claim(skill.name, `skills/${skill.name}/SKILL.md`);
  for (const command of loadCommandNames(topiaRoot)) {
    const aliased = command.name.startsWith('topia-') ? command.name.slice('topia-'.length) : null;
    claim(aliased && skillNames.has(aliased) ? aliased : command.name, command.file);
  }

  return [...claims]
    .filter(([, sources]) => sources.length > 1)
    .map(([name, sources]) => ({ name, sources }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Bare `/design` style input — not `/topia:design`.
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
 */
export function formatBareSlashRedirect(skillName) {
  return (
    `[Topia] Bare \`/${skillName}\` is not a Topia command (avoids clashes with built-in slash commands). ` +
    `Use \`/topia:${skillName}\` or \`/topia ${skillName}\`.`
  );
}

export { RESERVED_COMMANDS };
