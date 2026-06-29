/**
 * `topia memory seed` — import .topia/ markdown state into agora-code SQLite.
 *
 * Idempotent via .topia/.agora-seed.json content hash.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SEED_FLAG = '.agora-seed.json';
const CONVENTIONS_CAP = 10;

function which(cmd) {
  const winCmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(winCmd, [cmd], { encoding: 'utf-8' });
  if (result.status === 0 && result.stdout) {
    return result.stdout.split(/\r?\n/)[0].trim() || null;
  }
  return null;
}

function agoraCodeAvailable() {
  return Boolean(which('agora-code'));
}

/** @returns {{ finding: string, tags: string }[]} */
export function collectSeedFindings(projectRoot) {
  const topiaDir = path.join(projectRoot, '.topia');
  if (!existsSync(topiaDir)) return [];

  const findings = [];

  const decisionsPath = path.join(topiaDir, 'decisions.md');
  if (existsSync(decisionsPath)) {
    const text = readFileSync(decisionsPath, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      if (/^\|\s*Date\s*\|/i.test(line) || /^\|[-:\s|]+\|$/.test(line)) continue;
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length >= 2) {
        const row = cells.slice(0, 3).join(' — ');
        if (row.length > 12) findings.push({ finding: row, tags: 'topia-seed,decision' });
      }
    }
  }

  const adrDir = path.join(topiaDir, 'adr');
  if (existsSync(adrDir)) {
    for (const name of readdirSync(adrDir)) {
      if (!name.endsWith('.md')) continue;
      const body = readFileSync(path.join(adrDir, name), 'utf-8');
      const title = body.match(/^#\s+(.+)/m)?.[1] || name;
      const decisionBlock = body.match(/##\s*Decision\s*\n+([\s\S]*?)(?=\n##|\n#|$)/i)?.[1]?.trim();
      const text = decisionBlock ? `${title}: ${decisionBlock.slice(0, 400)}` : `${title} (see .topia/adr/${name})`;
      findings.push({ finding: text, tags: 'topia-seed,decision,adr' });
    }
  }

  const learningsPath = path.join(topiaDir, 'learnings.jsonl');
  if (existsSync(learningsPath)) {
    for (const line of readFileSync(learningsPath, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const f = row.finding || row.text || row.learning;
        if (f && typeof f === 'string') findings.push({ finding: f, tags: 'topia-seed,learning' });
      } catch {
        /* skip bad lines */
      }
    }
  }

  const conventionsPath = path.join(topiaDir, 'conventions.md');
  if (existsSync(conventionsPath)) {
    let count = 0;
    for (const line of readFileSync(conventionsPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      if (t.startsWith('- ') || t.startsWith('* ')) {
        findings.push({ finding: t.replace(/^[-*]\s+/, ''), tags: 'topia-seed,convention' });
        count += 1;
        if (count >= CONVENTIONS_CAP) break;
      }
    }
  }

  return findings;
}

function hashSources(projectRoot, findings) {
  const h = createHash('sha256');
  h.update(JSON.stringify(findings));
  for (const rel of ['decisions.md', 'learnings.jsonl', 'conventions.md']) {
    const p = path.join(projectRoot, '.topia', rel);
    if (existsSync(p)) h.update(readFileSync(p));
  }
  const adrDir = path.join(projectRoot, '.topia', 'adr');
  if (existsSync(adrDir)) {
    for (const name of readdirSync(adrDir).sort()) {
      if (name.endsWith('.md')) h.update(readFileSync(path.join(adrDir, name)));
    }
  }
  return h.digest('hex').slice(0, 16);
}

function readSeedFlag(projectRoot) {
  const flagPath = path.join(projectRoot, '.topia', SEED_FLAG);
  if (!existsSync(flagPath)) return null;
  try {
    return JSON.parse(readFileSync(flagPath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeSeedFlag(projectRoot, payload) {
  mkdirSync(path.join(projectRoot, '.topia'), { recursive: true });
  writeFileSync(path.join(projectRoot, '.topia', SEED_FLAG), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function storeViaCli(projectRoot, finding, tags) {
  execFileSync('agora-code', ['learn', finding, '--tags', tags, '--confidence', 'confirmed'], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
}

/**
 * @param {string} projectRoot
 * @param {{ dryRun?: boolean, force?: boolean }} [opts]
 */
export function runMemorySeed(projectRoot, opts = {}) {
  const { dryRun = false, force = false } = opts;
  const findings = collectSeedFindings(projectRoot);

  if (findings.length === 0) {
    return { ok: true, skipped: true, reason: 'no-seedable-files', count: 0 };
  }

  const contentHash = hashSources(projectRoot, findings);
  const prev = readSeedFlag(projectRoot);
  if (!force && prev?.contentHash === contentHash) {
    return { ok: true, skipped: true, reason: 'already-seeded', count: prev.count ?? 0, contentHash };
  }

  if (!agoraCodeAvailable()) {
    return { ok: false, skipped: true, reason: 'no-agora-cli', count: 0 };
  }

  if (dryRun) {
    return { ok: true, dryRun: true, count: findings.length, contentHash, findings: findings.map((f) => f.finding) };
  }

  let stored = 0;
  const errors = [];
  for (const { finding, tags } of findings) {
    try {
      storeViaCli(projectRoot, finding.slice(0, 2000), tags);
      stored += 1;
    } catch (err) {
      errors.push({ finding: finding.slice(0, 80), error: err.message });
    }
  }

  writeSeedFlag(projectRoot, {
    seededAt: new Date().toISOString(),
    contentHash,
    count: stored,
    attempted: findings.length,
  });

  return { ok: errors.length === 0, count: stored, contentHash, errors };
}
