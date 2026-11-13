#!/usr/bin/env node

/**
 * build-walkthrough.js — JSON spec of a change → a show-and-tell walkthrough
 * (Markdown by default, or one self-contained HTML file).
 *
 * Zero dependencies. Before writing, it checks the spec's evidence against git:
 * every cited commit must exist (and sit inside `range` when one is given), and
 * every cited file must exist on disk or appear in the range's diff. A claim with
 * no evidence does not render.
 *
 * Usage: node build-walkthrough.js --spec walkthrough.json [--format md|html] [--root dir] [--out-dir dir] [--json]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const VERSION = '1.0.0';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const SHA_RE = /^[0-9a-f]{4,64}$/i;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_LOG = 50;

export class WalkthroughError extends Error {
  constructor(problems) {
    super(`Walkthrough check failed:\n- ${problems.join('\n- ')}`);
    this.name = 'WalkthroughError';
    this.problems = problems;
  }
}

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function list(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

export function slugify(value) {
  const slug = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'walkthrough';
}

/** Validate shape and fill defaults. Throws WalkthroughError listing every problem. */
export function normalizeWalkthrough(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WalkthroughError(['spec must be a JSON object']);
  const problems = [];
  const title = text(raw.title).replace(/\s+/g, ' ');
  if (!title) problems.push('title is required');
  const id = raw.id === undefined ? slugify(title) : text(raw.id);
  if (!ID_RE.test(id)) problems.push(`id "${id}" must be lowercase letters, digits and dashes`);
  const summary = text(raw.summary);
  if (!summary) problems.push('summary is required (what changed and why, in a few sentences)');

  const changes = [];
  if (!Array.isArray(raw.changes) || raw.changes.length === 0) problems.push('changes must be a non-empty array');
  (Array.isArray(raw.changes) ? raw.changes : []).forEach((c, i) => {
    const where = `changes[${i}]`;
    if (!c || typeof c !== 'object') {
      problems.push(`${where} must be an object`);
      return;
    }
    const what = text(c.what);
    const why = text(c.why);
    const files = list(c.files);
    const commits = list(c.commits);
    if (!what) problems.push(`${where}.what is required`);
    if (!why) problems.push(`${where}.why is required`);
    if (files.length === 0 && commits.length === 0) {
      problems.push(`${where} cites no files or commits; every change needs evidence`);
    }
    for (const sha of commits) if (!SHA_RE.test(sha)) problems.push(`${where}: "${sha}" is not a commit sha`);
    changes.push({ what, why, files, commits });
  });

  const tryIt = [];
  if (!Array.isArray(raw.tryIt) || raw.tryIt.length === 0) problems.push('tryIt must list at least one step');
  (Array.isArray(raw.tryIt) ? raw.tryIt : []).forEach((s, i) => {
    const obj = typeof s === 'string' ? { step: s } : s;
    const step = text(obj?.step);
    if (!step) problems.push(`tryIt[${i}].step is required`);
    tryIt.push({ step, command: text(obj?.command), expect: text(obj?.expect) });
  });

  if (!Array.isArray(raw.lookFor)) problems.push('lookFor must be an array');
  if (!Array.isArray(raw.limits)) problems.push('limits must be an array (empty only if you found none)');

  const screenshots = [];
  (Array.isArray(raw.screenshots) ? raw.screenshots : []).forEach((s, i) => {
    const p = text(s?.path);
    const caption = text(s?.caption);
    if (!p) problems.push(`screenshots[${i}].path is required`);
    else if (!IMAGE_TYPES[path.extname(p).toLowerCase()])
      problems.push(`screenshots[${i}] must be png, jpg, gif or webp`);
    if (!caption) problems.push(`screenshots[${i}].caption is required`);
    screenshots.push({ path: p, caption });
  });

  if (problems.length > 0) throw new WalkthroughError(problems);
  return {
    id,
    title,
    summary,
    range: text(raw.range),
    changes,
    tryIt,
    lookFor: list(raw.lookFor),
    limits: list(raw.limits),
    screenshots,
  };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Check every claim against the repo. Returns { problems, log } where log is the
 * range's commits (sha + subject) when a range is given.
 */
export function verifyEvidence(spec, root) {
  const problems = [];
  let inRange = null;
  let changed = new Set();
  let log = [];
  if (spec.range) {
    try {
      inRange = new Set(git(root, ['rev-list', spec.range]).split('\n').filter(Boolean));
      changed = new Set(
        git(root, ['diff', '--name-only', spec.range.replace('...', '..')])
          .split('\n')
          .filter(Boolean),
      );
      log = git(root, ['log', `--max-count=${MAX_LOG}`, '--format=%h%x09%s', spec.range])
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [sha, ...rest] = l.split('\t');
          return { sha, subject: rest.join('\t') };
        });
    } catch {
      problems.push(`range "${spec.range}" does not resolve in ${root}`);
    }
  }
  const cited = new Set();
  spec.changes.forEach((c, i) => {
    for (const sha of c.commits) {
      cited.add(sha);
      let full = '';
      try {
        full = git(root, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
      } catch {
        problems.push(`changes[${i}]: commit ${sha} is not in this repo`);
        continue;
      }
      if (inRange && !inRange.has(full)) problems.push(`changes[${i}]: commit ${sha} is outside ${spec.range}`);
    }
    for (const f of c.files) {
      const rel = f.replace(/\\/g, '/');
      if (!existsSync(path.resolve(root, rel)) && !changed.has(rel)) {
        problems.push(`changes[${i}]: file ${f} does not exist and is not in the range's diff`);
      }
    }
  });
  spec.screenshots.forEach((s, i) => {
    const p = path.resolve(root, s.path);
    if (!existsSync(p)) problems.push(`screenshots[${i}]: ${s.path} not found`);
    else if (statSync(p).size > MAX_IMAGE_BYTES) problems.push(`screenshots[${i}]: ${s.path} is over 5 MB`);
  });
  return { problems, log };
}

// ── Rendering ─────────────────────────────────────────────────────────────

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape, then turn `code` spans into <code>. Nothing else is interpreted. */
function inline(value) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function paragraphsHtml(value) {
  return text(value)
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => `<p>${inline(p.trim())}</p>`)
    .join('\n');
}

function evidenceMd(c) {
  const parts = [];
  if (c.files.length) parts.push(`Files: ${c.files.map((f) => `\`${f}\``).join(', ')}`);
  if (c.commits.length) parts.push(`Commits: ${c.commits.map((s) => `\`${s}\``).join(', ')}`);
  return parts.join(' · ');
}

function provenance(spec, log, generatedAt) {
  const range = spec.range ? `\`${spec.range}\` (${log.length} commits)` : 'the cited commits and files';
  return `Built ${generatedAt.slice(0, 10)} from ${range}. Every change below cites its evidence.`;
}

export function renderMarkdown(
  spec,
  { log = [], outDir = '.', root = '.', generatedAt = new Date().toISOString() } = {},
) {
  const lines = [`# ${spec.title}`, '', spec.summary, '', `_${provenance(spec, log, generatedAt)}_`, ''];
  lines.push('## What changed and why', '');
  spec.changes.forEach((c, i) => {
    lines.push(`${i + 1}. **${c.what}** ${c.why}`, `   ${evidenceMd(c)}`);
  });
  lines.push('', '## Try it', '');
  spec.tryIt.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.step}`);
    if (s.command) lines.push('', '   ```sh', ...s.command.split('\n').map((l) => `   ${l}`), '   ```', '');
    if (s.expect) lines.push(`   Expect: ${s.expect}`);
  });
  lines.push('', '## What to look for', '');
  if (spec.lookFor.length) for (const l of spec.lookFor) lines.push(`- ${l}`);
  else lines.push('- Nothing beyond the steps above.');
  lines.push('', '## Known limits', '');
  if (spec.limits.length) for (const l of spec.limits) lines.push(`- ${l}`);
  else lines.push('- None found while testing.');
  if (spec.screenshots.length) {
    lines.push('', '## Screenshots', '');
    for (const s of spec.screenshots) {
      const rel = path.relative(outDir, path.resolve(root, s.path)).replace(/\\/g, '/');
      lines.push(`![${s.caption}](${encodeURI(rel)})`, '', `_${s.caption}_`, '');
    }
  }
  if (log.length) {
    lines.push('', '## Commits', '');
    for (const c of log) lines.push(`- \`${c.sha}\` ${c.subject}`);
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/**
 * Base look shared with skills/decision-form/scripts/decision-form.js. A test keeps
 * the two copies identical — edit both or neither.
 */
export const BASE_CSS = `:root{color-scheme:light dark;--bg:#fbfaf7;--surface:#fff;--text:#1d1d1b;--muted:#585853;--border:#d6d3cb;--accent:#1f5fbf;--accent-text:#fff;--accent-soft:#e8eff9;--changed:#8a4b00;--code-bg:#f0eee8;--focus:#1f5fbf}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--surface:#1f1f1d;--text:#ecebe6;--muted:#aeada6;--border:#3d3d39;--accent:#86b4ff;--accent-text:#0d1a2e;--accent-soft:#1c2a3e;--changed:#ffbe73;--code-bg:#2a2a27;--focus:#86b4ff}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}
main{max-width:46rem;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 .5rem}
h2{font-size:1.2rem;line-height:1.3;margin:2rem 0 .75rem}
p{margin:.5rem 0}
.muted{color:var(--muted)}
code,pre,textarea.mono{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.9em}
code{background:var(--code-bg);padding:.1em .3em;border-radius:4px}
pre{background:var(--code-bg);padding:12px;border-radius:6px;overflow-x:auto;white-space:pre}
pre code{background:none;padding:0}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
button{font:inherit;min-height:44px;padding:.5rem 1rem;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer}
button.primary{background:var(--accent);color:var(--accent-text);border-color:var(--accent);font-weight:600}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}`;

const PAGE_CSS = `.meta{color:var(--muted);font-size:.92em}
ol.changes>li,ol.steps>li{margin:0 0 1rem}
.evidence{display:block;color:var(--muted);font-size:.9em;margin-top:.25rem}
.expect{margin:.25rem 0 0}
figure{margin:1rem 0}
figure img{max-width:100%;height:auto;border:1px solid var(--border);border-radius:6px}
figcaption{color:var(--muted);font-size:.92em;margin-top:.25rem}
ul.log{list-style:none;padding:0}
ul.log li{margin:.2rem 0}`;

export function renderHtml(spec, { log = [], root = '.', generatedAt = new Date().toISOString() } = {}) {
  const e = escapeHtml;
  const out = [];
  out.push(`<h1>${e(spec.title)}</h1>`, paragraphsHtml(spec.summary));
  out.push(`<p class="meta">${inline(provenance(spec, log, generatedAt))}</p>`);
  out.push('<h2>What changed and why</h2>', '<ol class="changes">');
  for (const c of spec.changes) {
    const ev = [];
    if (c.files.length) ev.push(`Files: ${c.files.map((f) => `<code>${e(f)}</code>`).join(', ')}`);
    if (c.commits.length) ev.push(`Commits: ${c.commits.map((s) => `<code>${e(s)}</code>`).join(', ')}`);
    out.push(
      `<li><strong>${inline(c.what)}</strong> ${inline(c.why)}<span class="evidence">${ev.join(' · ')}</span></li>`,
    );
  }
  out.push('</ol>', '<h2>Try it</h2>', '<ol class="steps">');
  for (const s of spec.tryIt) {
    const parts = [inline(s.step)];
    if (s.command) parts.push(`<pre><code>${e(s.command)}</code></pre>`);
    if (s.expect) parts.push(`<p class="expect"><strong>Expect:</strong> ${inline(s.expect)}</p>`);
    out.push(`<li>${parts.join('\n')}</li>`);
  }
  out.push('</ol>', '<h2>What to look for</h2>', '<ul>');
  const look = spec.lookFor.length ? spec.lookFor : ['Nothing beyond the steps above.'];
  for (const l of look) out.push(`<li>${inline(l)}</li>`);
  out.push('</ul>', '<h2>Known limits</h2>', '<ul>');
  const limits = spec.limits.length ? spec.limits : ['None found while testing.'];
  for (const l of limits) out.push(`<li>${inline(l)}</li>`);
  out.push('</ul>');
  if (spec.screenshots.length) {
    out.push('<h2>Screenshots</h2>');
    for (const s of spec.screenshots) {
      const file = path.resolve(root, s.path);
      const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
      const data = readFileSync(file).toString('base64');
      out.push(
        `<figure><img src="data:${type};base64,${data}" alt="${e(s.caption)}"><figcaption>${inline(s.caption)}</figcaption></figure>`,
      );
    }
  }
  if (log.length) {
    out.push('<h2>Commits</h2>', '<ul class="log">');
    for (const c of log) out.push(`<li><code>${e(c.sha)}</code> ${e(c.subject)}</li>`);
    out.push('</ul>');
  }
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="generator" content="topia docs show-and-tell ${VERSION}">
<title>${e(spec.title)}</title>
<style>
${BASE_CSS}
${PAGE_CSS}
</style>
</head>
<body>
<main>
${out.join('\n')}
</main>
</body>
</html>
`;
}

// ── CLI ───────────────────────────────────────────────────────────────────

const HELP = `build-walkthrough ${VERSION}: render a show-and-tell walkthrough from a JSON spec.

Usage:
  node build-walkthrough.js --spec <walkthrough.json|-> [--format md|html] [--root <repo>] [--out-dir <dir>]
                            [--json] [--dry-run] [--debug] [--skip-verify]
  node build-walkthrough.js --help | --version | --smoke

Checks every cited commit and file against git in --root (default: cwd), then writes
<out-dir>/<id>.md or .html and prints the path. HTML embeds screenshots, so it is one file.
Out dir: --out-dir, else $SHOW_AND_TELL_OUT_DIR, else the OpenClaw dirs, else <root>/.topia/show-and-tell/.

Exit codes: 0 ok, 1 could not read or write a file, 2 usage error, 3 invalid spec or evidence check failed.`;

export function resolveOutDir(flag, env, root) {
  if (flag) return path.resolve(root, flag);
  if (env.SHOW_AND_TELL_OUT_DIR) return path.resolve(root, env.SHOW_AND_TELL_OUT_DIR);
  if (env.OPENCLAW_OUTPUT_DIR) return path.resolve(root, env.OPENCLAW_OUTPUT_DIR);
  if (env.OPENCLAW_AGENT_DIR) return path.join(env.OPENCLAW_AGENT_DIR, 'artifacts', 'show-and-tell');
  if (env.OPENCLAW_STATE_DIR) return path.join(env.OPENCLAW_STATE_DIR, 'artifacts', 'show-and-tell');
  return path.join(root, '.topia', 'show-and-tell');
}

export function run(
  argv,
  { env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {},
) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        spec: { type: 'string' },
        format: { type: 'string', default: 'md' },
        'out-dir': { type: 'string' },
        root: { type: 'string' },
        json: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        debug: { type: 'boolean', default: false },
        'skip-verify': { type: 'boolean', default: false },
        smoke: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (err) {
    stderr.write(`${err.message}\n\n${HELP}\n`);
    return 2;
  }
  if (values.help) {
    stdout.write(`${HELP}\n`);
    return 0;
  }
  if (values.version) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }
  const root = path.resolve(cwd, values.root ?? '.');
  const outDir = resolveOutDir(values['out-dir'], env, root);
  const debug = (event, data = {}) => {
    if (values.debug) stderr.write(`[debug] ${event} ${JSON.stringify(data)}\n`);
  };
  if (values.smoke) {
    try {
      git(root, ['--version']);
      stderr.write(`ok: git found, out dir ${outDir}\n`);
      return 0;
    } catch {
      stderr.write('git is not on PATH; install git or pass --skip-verify\n');
      return 1;
    }
  }
  if (!values.spec) {
    stderr.write(`Pass --spec <file>.\n\n${HELP}\n`);
    return 2;
  }
  if (values.format !== 'md' && values.format !== 'html') {
    stderr.write(`--format must be md or html, not "${values.format}"\n`);
    return 2;
  }
  try {
    const source = values.spec === '-' ? readFileSync(0, 'utf8') : readFileSync(path.resolve(cwd, values.spec), 'utf8');
    let raw;
    try {
      raw = JSON.parse(source);
    } catch (err) {
      throw new WalkthroughError([`spec is not valid JSON: ${err.message}`]);
    }
    const spec = normalizeWalkthrough(raw);
    let log = [];
    if (!values['skip-verify']) {
      const result = verifyEvidence(spec, root);
      if (result.problems.length) throw new WalkthroughError(result.problems);
      log = result.log;
      debug('verified', { changes: spec.changes.length, commits: log.length });
    } else {
      stderr.write('warning: evidence not checked (--skip-verify); say so when you share it\n');
    }
    const file = path.join(outDir, `${spec.id}.${values.format}`);
    const body =
      values.format === 'html' ? renderHtml(spec, { log, root }) : renderMarkdown(spec, { log, outDir, root });
    if (!values['dry-run']) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(file, body, 'utf8');
    }
    const summary = {
      status: values['dry-run'] ? 'dry-run' : 'written',
      path: file,
      format: values.format,
      verified: !values['skip-verify'],
      changes: spec.changes.length,
      commits: log.length,
    };
    stdout.write(values.json ? `${JSON.stringify(summary, null, 2)}\n` : `${file}\n`);
    return 0;
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return err instanceof WalkthroughError ? 3 : 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = run(process.argv.slice(2));
