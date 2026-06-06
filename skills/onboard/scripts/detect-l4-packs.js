#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const PACK_RULES = [
  { pack: '@Topia/ui', reason: 'Frontend patterns, design system, accessibility', match: (c) => /react|next\.js|vue|svelte/i.test(c.signals) },
  { pack: '@Topia/backend', reason: 'API patterns, auth, middleware', match: (c) => /express|fastify|fastapi|django|nestjs|flask/i.test(c.signals) },
  { pack: '@Topia/devops', reason: 'CI/CD, containers, IaC', match: (c) => /docker|kubernetes|terraform|github actions|ci\/cd/i.test(c.signals) },
  { pack: '@Topia/mobile', reason: 'Mobile architecture, offline sync', match: (c) => /react native|expo|flutter|swiftui/i.test(c.signals) },
  { pack: '@Topia/security', reason: 'OWASP, compliance', match: (c) => /auth|payment|hipaa|pci|owasp/i.test(c.signals) },
  { pack: '@Topia/ecommerce', reason: 'Cart, checkout, inventory', match: (c) => /cart|checkout|shopify|ecommerce/i.test(c.signals) },
  { pack: '@Topia/ai-ml', reason: 'LLM, inference, model evaluation', match: (c) => /ml|llm|embedding|pytorch|inference|tts|qwen|parler/i.test(c.signals) },
  { pack: '@Topia/content', reason: 'CMS, SEO, editorial', match: (c) => /cms|blog|mdx|seo|content/i.test(c.signals) },
  { pack: '@Topia/analytics', reason: 'Dashboards, pipelines, BI', match: (c) => /analytics|dashboard|metrics|data pipeline/i.test(c.signals) },
  { pack: '@Topia/chrome-ext', reason: 'MV3 extensions', match: (c) => /chrome extension|manifest v3/i.test(c.signals) },
];

/** @param {string} pack e.g. @Topia/ui */
export function packIdToDirName(pack) {
  const m = /^@Topia\/(.+)$/.exec(pack);
  return m ? m[1] : pack.replace(/^@Topia\//, '');
}

export function detectL4Packs(ctx) {
  const seen = new Set();
  const out = [];
  for (const rule of PACK_RULES) {
    if (rule.match(ctx) && !seen.has(rule.pack)) {
      seen.add(rule.pack);
      out.push({ pack: rule.pack, reason: rule.reason });
    }
  }
  return out;
}

function readTextIfExists(filePath) {
  if (!existsSync(filePath)) return '';
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function packageJsonSignals(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return { framework: '', language: 'javascript', text: '' };
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const depNames = Object.keys(deps).join(' ');
    const scripts = Object.values(pkg.scripts || {}).join(' ');
    const text = `${depNames} ${scripts}`;
    let framework = '';
    if (/next/i.test(depNames)) framework = 'next.js';
    else if (/react/i.test(depNames)) framework = 'react';
    else if (/vue/i.test(depNames)) framework = 'vue';
    else if (/svelte/i.test(depNames)) framework = 'svelte';
    else if (/express/i.test(depNames)) framework = 'express';
    else if (/fastify/i.test(depNames)) framework = 'fastify';
    else if (/nestjs/i.test(depNames)) framework = 'nestjs';
    return { framework, language: 'javascript', text };
  } catch {
    return { framework: '', language: 'javascript', text: '' };
  }
}

/**
 * Deterministic stack signals from repo files (no LLM).
 * @param {string} projectRoot
 * @returns {{ framework: string, language: string, signals: string }}
 */
export function collectProjectSignals(projectRoot) {
  const parts = [];
  let framework = '';
  let language = '';

  const pkg = packageJsonSignals(projectRoot);
  if (pkg.text) {
    parts.push(pkg.text);
    framework = pkg.framework || framework;
    language = pkg.language || language;
  }

  const pyproject = readTextIfExists(path.join(projectRoot, 'pyproject.toml'));
  if (pyproject) {
    parts.push(pyproject);
    language = language || 'python';
    if (/fastapi/i.test(pyproject)) framework = framework || 'fastapi';
    if (/django/i.test(pyproject)) framework = framework || 'django';
    if (/flask/i.test(pyproject)) framework = framework || 'flask';
  }

  const cargo = readTextIfExists(path.join(projectRoot, 'Cargo.toml'));
  if (cargo) {
    parts.push(cargo);
    language = language || 'rust';
  }

  const goMod = readTextIfExists(path.join(projectRoot, 'go.mod'));
  if (goMod) {
    parts.push(goMod);
    language = language || 'go';
  }

  const composer = readTextIfExists(path.join(projectRoot, 'composer.json'));
  if (composer) {
    parts.push(composer);
    language = language || 'php';
  }

  const filenameHints = [
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'manifest.json',
  ];
  for (const name of filenameHints) {
    if (existsSync(path.join(projectRoot, name))) {
      parts.push(name.replace(/\.(json|ya?ml)$/i, ''));
      if (name === 'Dockerfile') parts.push('docker');
      if (name === 'manifest.json') parts.push('chrome extension manifest v3');
    }
  }

  const ghWorkflows = path.join(projectRoot, '.github', 'workflows');
  if (existsSync(ghWorkflows)) {
    parts.push('github actions ci/cd');
    try {
      for (const f of readdirSync(ghWorkflows)) {
        if (f.endsWith('.yml') || f.endsWith('.yaml')) {
          parts.push(readTextIfExists(path.join(ghWorkflows, f)).slice(0, 2000));
        }
      }
    } catch { /* ignore */ }
  }

  for (const pattern of ['tailwind.config.js', 'tailwind.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.ts']) {
    if (existsSync(path.join(projectRoot, pattern))) {
      parts.push(pattern);
      if (pattern.includes('tailwind')) parts.push('tailwind');
      if (pattern.includes('next')) framework = framework || 'next.js';
    }
  }

  const signals = parts.join(' ').replace(/\s+/g, ' ').trim();
  return { framework, language, signals };
}

export function writeActivePacks(projectRoot, detected, force = false, source = 'onboard') {
  mkdirSync(path.join(projectRoot, '.topia'), { recursive: true });
  const outPath = path.join(projectRoot, '.topia', 'active-packs.json');
  let existing = { enabled: [], packs: {} };
  if (existsSync(outPath)) {
    try {
      existing = JSON.parse(readFileSync(outPath, 'utf-8'));
      if (!Array.isArray(existing.enabled)) existing.enabled = [];
      if (!existing.packs) existing.packs = {};
    } catch {
      existing = { enabled: [], packs: {} };
    }
  }
  const enabledSet = new Set(existing.enabled);
  const packs = { ...existing.packs };
  const activatedAt = new Date().toISOString();
  for (const { pack, reason } of detected) {
    enabledSet.add(pack);
    packs[pack] = { reason, source, activatedAt };
  }
  if (!force && detected.length === 0 && existing.enabled.length > 0) {
    return { path: outPath, enabled: [...existing.enabled], merged: false };
  }
  const payload = {
    enabled: [...enabledSet].sort(),
    packs,
    source,
    updatedAt: activatedAt,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return { path: outPath, enabled: payload.enabled, merged: true };
}

export function formatActivePacksClaudeSection(enabled) {
  if (!enabled.length) return '';
  return `## Topia — Active L4 packs
This project uses: ${enabled.join(', ')}
(Shipped with Topia; enabled for this workspace — \`build\` applies domain patterns during matching work. Config: .topia/active-packs.json)
`;
}

export function mergeTopiaConfigExtensions(projectRoot, enabled) {
  const cfgPath = path.join(projectRoot, 'topia.config.json');
  if (!existsSync(cfgPath) || !enabled.length) return { updated: false };
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  if (!cfg.extensions) cfg.extensions = {};
  cfg.extensions.enabled = enabled.map((p) => packIdToDirName(p));
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  return { updated: true, path: cfgPath };
}

/**
 * Detect L4 packs from project files and write active-packs.json.
 * @param {string} projectRoot
 * @param {{ signals?: string, force?: boolean, dryRun?: boolean, source?: string }} [opts]
 */
export function activateL4PacksForProject(projectRoot, opts = {}) {
  const { force = false, dryRun = false, source = 'onboard' } = opts;
  const collected = collectProjectSignals(projectRoot);
  const ctx = {
    framework: opts.framework ?? collected.framework,
    language: opts.language ?? collected.language,
    signals: opts.signals ?? collected.signals,
  };
  const detected = detectL4Packs(ctx);
  if (dryRun) {
    return {
      detected,
      enabled: detected.map((d) => d.pack),
      path: path.join(projectRoot, '.topia', 'active-packs.json'),
      merged: false,
      topiaConfig: { updated: false },
      claudeSection: formatActivePacksClaudeSection(detected.map((d) => d.pack)),
      collected,
    };
  }
  const result = writeActivePacks(projectRoot, detected, force, source);
  const cfg = mergeTopiaConfigExtensions(projectRoot, result.enabled);
  return {
    detected,
    ...result,
    topiaConfig: cfg,
    claudeSection: formatActivePacksClaudeSection(result.enabled),
    collected,
  };
}

/** True when project looks like an app repo (not empty Topia-only checkout). */
export function isProjectRepoRoot(projectRoot) {
  const markers = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'composer.json'];
  return markers.some((m) => existsSync(path.join(projectRoot, m)));
}

const isMain =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('detect-l4-packs.js');

if (isMain) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: process.cwd() },
      framework: { type: 'string', default: '' },
      language: { type: 'string', default: '' },
      signals: { type: 'string', default: '' },
      json: { type: 'string' },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const extra = values.json ? JSON.parse(values.json) : {};
  const result = activateL4PacksForProject(values.root, {
    force: values.force,
    dryRun: values['dry-run'],
    framework: values.framework || extra.framework,
    language: values.language || extra.language,
    signals: values.signals || extra.signals,
    source: extra.source || 'onboard',
  });
  console.log(JSON.stringify(result, null, 2));
}
