#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

export function writeActivePacks(projectRoot, detected, force = false) {
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
  for (const { pack, reason } of detected) {
    enabledSet.add(pack);
    packs[pack] = { reason, source: 'onboard', activatedAt: new Date().toISOString() };
  }
  if (!force && detected.length === 0 && existing.enabled.length > 0) {
    return { path: outPath, enabled: [...existing.enabled], merged: false };
  }
  const payload = {
    enabled: [...enabledSet].sort(),
    packs,
    source: 'onboard',
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return { path: outPath, enabled: payload.enabled, merged: true };
}

export function formatActivePacksClaudeSection(enabled) {
  if (!enabled.length) return '';
  return `## Topia — Active L4 packs
This project uses: ${enabled.join(', ')}
(Config: .topia/active-packs.json — apply during build/review/API/ML work.)
`;
}

export function mergeTopiaConfigExtensions(projectRoot, enabled) {
  const cfgPath = path.join(projectRoot, 'topia.config.json');
  if (!existsSync(cfgPath) || !enabled.length) return { updated: false };
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  if (!cfg.extensions) cfg.extensions = {};
  cfg.extensions.enabled = enabled;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  return { updated: true, path: cfgPath };
}

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: process.cwd() },
    framework: { type: 'string', default: '' },
    language: { type: 'string', default: '' },
    signals: { type: 'string', default: '' },
    json: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});

let ctx = {
  signals: [values.framework, values.language, values.signals].filter(Boolean).join(' '),
};
if (values.json) Object.assign(ctx, JSON.parse(values.json));

const detected = detectL4Packs(ctx);
const result = writeActivePacks(values.root, detected, values.force);
const cfg = mergeTopiaConfigExtensions(values.root, result.enabled);
console.log(JSON.stringify({ detected, ...result, claudeSection: formatActivePacksClaudeSection(result.enabled), topiaConfig: cfg }, null, 2));
