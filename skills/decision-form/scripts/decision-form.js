#!/usr/bin/env node

/**
 * decision-form.js — JSON spec of decisions → one self-contained HTML form,
 * and the parser for the answer block that form exports.
 *
 * Zero dependencies. The page makes no network requests (a CSP meta tag forbids
 * them) and works opened straight from disk.
 *
 * Build:  node decision-form.js --spec spec.json [--out-dir dir] [--root dir] [--json]
 * Parse:  node decision-form.js --parse answers.txt [--spec spec.json] [--json]
 *
 * The answer block grammar lives in ../references/answer-block.md. The browser
 * runs formatAnswerBlock() and buildAnswerJson() from this file verbatim (they are
 * inlined with Function#toString), so the page and the parser cannot drift.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const VERSION = '1.0.0';
export const FORMAT_VERSION = 1;
export const BLOCK_END = 'END TOPIA-DECISIONS';
export const JSON_FORMAT_NAME = 'topia-decisions';
export const MAX_DECISIONS = 60;
export const MAX_OPTIONS = 12;
/** Above this many options a decision renders as a <select> instead of radios. */
export const SELECT_THRESHOLD = 6;

const FORM_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const HEADER_RE = /^TOPIA-DECISIONS\s+v(\d+)\s+form=(\S+)\s+count=(\d+)$/;
const LINE_RE =
  /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*=\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*\|\s*(default|changed)(?:\s*\|\s*note:\s*(".*"))?$/;

// ── Errors ────────────────────────────────────────────────────────────────

export class SpecError extends Error {
  constructor(problems) {
    super(`Invalid decision spec:\n- ${problems.join('\n- ')}`);
    this.name = 'SpecError';
    this.problems = problems;
  }
}

export class AnswerBlockError extends Error {
  constructor(message, line) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = 'AnswerBlockError';
    this.line = line ?? null;
  }
}

// ── Spec ──────────────────────────────────────────────────────────────────

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function oneLine(value) {
  return text(value).replace(/\s+/g, ' ');
}

export function slugify(value) {
  const slug = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'decisions';
}

function letterId(index) {
  return String.fromCharCode(97 + index);
}

/**
 * Validate a raw spec and fill defaults. Throws SpecError listing every problem.
 * @returns {{id: string, title: string, intro: string, decisions: Array<object>}}
 */
export function normalizeSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SpecError(['spec must be a JSON object']);
  const problems = [];
  const title = oneLine(raw.title);
  if (!title) problems.push('title is required');
  const id = raw.id === undefined ? slugify(title) : text(raw.id);
  if (!FORM_ID_RE.test(id)) problems.push(`id "${id}" must be lowercase letters, digits and dashes (max 64)`);

  const list = Array.isArray(raw.decisions) ? raw.decisions : [];
  if (list.length === 0) problems.push('decisions must be a non-empty array');
  if (list.length > MAX_DECISIONS)
    problems.push(`too many decisions (${list.length}); split into forms of ${MAX_DECISIONS} or fewer`);

  const seen = new Set();
  const decisions = [];
  list.forEach((d, i) => {
    const where = `decisions[${i}]`;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      problems.push(`${where} must be an object`);
      return;
    }
    const did = d.id === undefined ? `d${i + 1}` : text(d.id);
    if (!ID_RE.test(did)) problems.push(`${where}.id "${did}" may use only letters, digits, "_", "." and "-"`);
    if (seen.has(did)) problems.push(`${where}.id "${did}" is used twice`);
    seen.add(did);

    const question = oneLine(d.question);
    if (!question) problems.push(`${where}.question is required`);

    const rawOptions = Array.isArray(d.options) ? d.options : [];
    if (rawOptions.length < 2) problems.push(`${where} needs at least 2 options`);
    if (rawOptions.length > MAX_OPTIONS) problems.push(`${where} has more than ${MAX_OPTIONS} options`);
    const optionIds = new Set();
    const options = [];
    rawOptions.forEach((o, j) => {
      const obj = typeof o === 'string' ? { label: o } : o;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        problems.push(`${where}.options[${j}] must be a string or an object`);
        return;
      }
      const oid = obj.id === undefined ? letterId(j) : text(obj.id);
      if (!ID_RE.test(oid))
        problems.push(`${where}.options[${j}].id "${oid}" may use only letters, digits, "_", "." and "-"`);
      if (optionIds.has(oid)) problems.push(`${where}.options[${j}].id "${oid}" is used twice`);
      optionIds.add(oid);
      const label = oneLine(obj.label);
      if (!label) problems.push(`${where}.options[${j}].label is required`);
      options.push({ id: oid, label, detail: oneLine(obj.detail) });
    });

    let def = text(d.default);
    if (def && !optionIds.has(def)) {
      const byLabel = options.find((o) => o.label === def);
      if (byLabel) def = byLabel.id;
    }
    if (!def) problems.push(`${where}.default is required (the recommended option id)`);
    else if (!optionIds.has(def)) problems.push(`${where}.default "${def}" is not one of its option ids`);

    const reason = oneLine(d.reason);
    if (!reason) problems.push(`${where}.reason is required (one line on why the default)`);

    decisions.push({
      id: did,
      question,
      context: text(d.context),
      group: oneLine(d.group),
      options,
      default: def,
      reason,
    });
  });

  if (problems.length > 0) throw new SpecError(problems);
  return { id, title, intro: text(raw.intro), decisions };
}

// ── Answer block (shared with the browser — keep these two self-contained) ──

/**
 * Format answers as the plain-text block the person pastes into chat.
 * Runs in the browser via Function#toString, so it must not use anything from
 * module scope.
 * @param {string} formId
 * @param {Array<{id: string, choice: string, status: string, note?: string}>} answers
 */
export function formatAnswerBlock(formId, answers) {
  const lines = [`TOPIA-DECISIONS v1 form=${formId} count=${answers.length}`];
  for (const a of answers) {
    let line = `${a.id} = ${a.choice} | ${a.status}`;
    const note = String(a.note ?? '').trim();
    if (note) line += ` | note: ${JSON.stringify(note)}`;
    lines.push(line);
  }
  lines.push('END TOPIA-DECISIONS');
  return lines.join('\n');
}

/**
 * Build the JSON answer object used by the .json download. Browser-safe like
 * formatAnswerBlock.
 */
export function buildAnswerJson(formId, answers) {
  return {
    format: 'topia-decisions',
    version: 1,
    form: formId,
    answers: answers.map((a) => {
      const out = { id: a.id, choice: a.choice, status: a.status };
      const note = String(a.note ?? '').trim();
      if (note) out.note = note;
      return out;
    }),
  };
}

// ── Parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a TOPIA-DECISIONS block out of pasted text (chat message, .md download).
 * Text around the block is ignored. Throws AnswerBlockError on anything ambiguous.
 * With a spec, ids and choices are checked and each answer gains question/label.
 */
export function parseAnswerBlock(input, spec) {
  const lines = String(input).split(/\r?\n/);
  const starts = [];
  lines.forEach((l, i) => {
    if (/^TOPIA-DECISIONS\b/.test(l.trim())) starts.push(i);
  });
  if (starts.length === 0) throw new AnswerBlockError('No TOPIA-DECISIONS block found');
  if (starts.length > 1) throw new AnswerBlockError(`Found ${starts.length} TOPIA-DECISIONS blocks; paste exactly one`);

  const start = starts[0];
  const header = HEADER_RE.exec(lines[start].trim());
  if (!header) throw new AnswerBlockError('Header must read "TOPIA-DECISIONS v1 form=<id> count=<n>"', start + 1);
  if (Number(header[1]) !== FORMAT_VERSION) {
    throw new AnswerBlockError(
      `Unsupported block version v${header[1]}; this parser reads v${FORMAT_VERSION}`,
      start + 1,
    );
  }
  const formId = header[2];
  const count = Number(header[3]);

  const answers = [];
  const seen = new Set();
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === BLOCK_END) {
      end = i;
      break;
    }
    if (line === '') continue;
    const m = LINE_RE.exec(line);
    if (!m) throw new AnswerBlockError(`Not an answer line: ${line.slice(0, 80)}`, i + 1);
    let note = '';
    if (m[4] !== undefined) {
      try {
        note = JSON.parse(m[4]);
      } catch {
        throw new AnswerBlockError('Note is not a valid JSON string', i + 1);
      }
      if (typeof note !== 'string') throw new AnswerBlockError('Note is not a valid JSON string', i + 1);
    }
    if (seen.has(m[1])) throw new AnswerBlockError(`Decision "${m[1]}" is answered twice`, i + 1);
    seen.add(m[1]);
    answers.push({ id: m[1], choice: m[2], status: m[3], note });
  }
  if (end < 0) throw new AnswerBlockError(`Missing "${BLOCK_END}" line; the block may be cut off`);
  if (answers.length !== count) {
    throw new AnswerBlockError(`Header says count=${count} but the block has ${answers.length} answers`);
  }
  const result = { version: FORMAT_VERSION, formId, answers, warnings: [] };
  return spec ? checkAgainstSpec(result, spec) : result;
}

/** Parse the .json download. Same checks as the text block. */
export function parseAnswerJson(input, spec) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (err) {
      throw new AnswerBlockError(`Answer JSON does not parse: ${err.message}`);
    }
  }
  if (!data || data.format !== JSON_FORMAT_NAME)
    throw new AnswerBlockError(`JSON "format" must be "${JSON_FORMAT_NAME}"`);
  if (data.version !== FORMAT_VERSION) throw new AnswerBlockError(`Unsupported JSON version ${data.version}`);
  if (typeof data.form !== 'string' || !data.form) throw new AnswerBlockError('JSON "form" is required');
  if (!Array.isArray(data.answers)) throw new AnswerBlockError('JSON "answers" must be an array');
  const seen = new Set();
  const answers = data.answers.map((a, i) => {
    const id = text(a?.id);
    const choice = text(a?.choice);
    const status = text(a?.status);
    if (!ID_RE.test(id) || !ID_RE.test(choice)) throw new AnswerBlockError(`answers[${i}] needs a valid id and choice`);
    if (status !== 'default' && status !== 'changed') {
      throw new AnswerBlockError(`answers[${i}].status must be "default" or "changed"`);
    }
    if (seen.has(id)) throw new AnswerBlockError(`Decision "${id}" is answered twice`);
    seen.add(id);
    if (a.note !== undefined && typeof a.note !== 'string')
      throw new AnswerBlockError(`answers[${i}].note must be a string`);
    return { id, choice, status, note: text(a.note) };
  });
  const result = { version: FORMAT_VERSION, formId: data.form, answers, warnings: [] };
  return spec ? checkAgainstSpec(result, spec) : result;
}

/** Accept either the text block or the JSON download. */
export function parseAnswers(input, spec) {
  const trimmed = String(input).trim();
  if (trimmed.startsWith('{')) return parseAnswerJson(trimmed, spec);
  return parseAnswerBlock(input, spec);
}

function checkAgainstSpec(result, rawSpec) {
  // normalizeSpec is idempotent, so a saved .spec.json and a raw spec both work.
  const spec = normalizeSpec(rawSpec);
  if (result.formId !== spec.id) {
    throw new AnswerBlockError(`Block is for form "${result.formId}", but the spec is "${spec.id}"`);
  }
  const byId = new Map(spec.decisions.map((d) => [d.id, d]));
  const answered = new Set();
  for (const a of result.answers) {
    const d = byId.get(a.id);
    if (!d) throw new AnswerBlockError(`Decision "${a.id}" is not in the spec`);
    const option = d.options.find((o) => o.id === a.choice);
    if (!option) throw new AnswerBlockError(`"${a.choice}" is not an option of ${a.id}`);
    const status = a.choice === d.default ? 'default' : 'changed';
    if (status !== a.status) {
      result.warnings.push(`${a.id}: marked "${a.status}" but the choice is ${status}; using "${status}"`);
      a.status = status;
    }
    a.question = d.question;
    a.label = option.label;
    a.recommended = d.default;
    answered.add(a.id);
  }
  const missing = spec.decisions.filter((d) => !answered.has(d.id)).map((d) => d.id);
  if (missing.length > 0) throw new AnswerBlockError(`Missing answers for: ${missing.join(', ')}`);
  // Report in spec order, whatever order the block used.
  const order = new Map(spec.decisions.map((d, i) => [d.id, i]));
  result.answers.sort((x, y) => order.get(x.id) - order.get(y.id));
  return result;
}

// ── HTML ──────────────────────────────────────────────────────────────────

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphs(value) {
  return text(value)
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join('\n');
}

/**
 * Base look shared with skills/docs/scripts/build-walkthrough.js. A test keeps the
 * two copies identical — edit both or neither.
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

const FORM_CSS = `.how{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin:1rem 0 1.5rem}
fieldset.decision{border:1px solid var(--border);border-radius:8px;background:var(--surface);margin:0 0 16px;padding:12px 16px 16px;min-width:0}
fieldset.decision[data-changed="true"]{border-color:var(--changed);box-shadow:inset 4px 0 0 var(--changed)}
legend{font-weight:600;padding:0 4px;max-width:100%}
.qnum{color:var(--muted);font-weight:500;margin-right:.3em}
.context{color:var(--muted);margin:.25rem 0}
.rec{background:var(--accent-soft);border-radius:6px;padding:6px 10px;margin:.5rem 0 .75rem;font-size:.95em}
.options{display:grid;gap:6px}
.option{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer}
.option:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.option input{margin:.25rem 0 0;width:1.15rem;height:1.15rem;flex:none;accent-color:var(--accent)}
.badge{display:inline-block;font-size:.75rem;font-weight:600;padding:0 .4em;border-radius:4px;border:1px solid currentColor;color:var(--accent);margin-left:.4em}
.detail{display:block;color:var(--muted);font-size:.92em}
.changed-flag{display:none;color:var(--changed);font-size:.85em;font-weight:600;margin-left:.4em}
fieldset[data-changed="true"] .changed-flag{display:inline}
select,textarea{font:inherit;width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)}
details.note{margin-top:10px}
details.note summary{cursor:pointer;color:var(--muted);padding:4px 0}
details.note label{display:block;font-size:.9em;color:var(--muted);margin:4px 0}
.actions{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--border);padding:12px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#counter{flex:1 1 100%;color:var(--muted);font-size:.9em}
#status{flex:1 1 100%;font-size:.95em;min-height:1.5em}
#out-wrap label{display:block;font-weight:600;margin:1rem 0 .25rem}
#out{min-height:9rem}
@media (max-width:600px){.actions{position:static}}`;

function renderDecision(d, n) {
  const useSelect = d.options.length > SELECT_THRESHOLD;
  const recommended = d.options.find((o) => o.id === d.default);
  const e = escapeHtml;
  const parts = [
    `<fieldset class="decision" id="dec-${e(d.id)}" data-id="${e(d.id)}" data-default="${e(d.default)}" data-changed="false">`,
    `<legend><span class="qnum">${n}.</span>${e(d.question)}<span class="changed-flag">Changed</span></legend>`,
  ];
  if (d.context) parts.push(`<p class="context">${e(d.context)}</p>`);
  parts.push(`<p class="rec"><strong>Recommended: ${e(recommended.label)}.</strong> ${e(d.reason)}</p>`);
  if (useSelect) {
    parts.push(`<label class="muted" for="sel-${e(d.id)}">Choose one</label>`);
    parts.push(`<select id="sel-${e(d.id)}" name="d-${e(d.id)}">`);
    for (const o of d.options) {
      const suffix = o.id === d.default ? ' (recommended)' : '';
      const detail = o.detail ? ` — ${o.detail}` : '';
      const sel = o.id === d.default ? ' selected' : '';
      parts.push(`<option value="${e(o.id)}"${sel}>${e(o.label + detail + suffix)}</option>`);
    }
    parts.push('</select>');
  } else {
    parts.push('<div class="options">');
    for (const o of d.options) {
      const inputId = `opt-${d.id}-${o.id}`;
      const checked = o.id === d.default ? ' checked' : '';
      const badge = o.id === d.default ? '<span class="badge">Recommended</span>' : '';
      const detail = o.detail ? `<span class="detail">${e(o.detail)}</span>` : '';
      parts.push(
        `<label class="option" for="${e(inputId)}"><input type="radio" id="${e(inputId)}" name="d-${e(d.id)}" value="${e(o.id)}"${checked}><span>${e(o.label)}${badge}${detail}</span></label>`,
      );
    }
    parts.push('</div>');
  }
  parts.push(
    `<details class="note"><summary>Add a note</summary><label for="note-${e(d.id)}">Note for ${n} (optional)</label><textarea id="note-${e(d.id)}" rows="2"></textarea></details>`,
  );
  parts.push('</fieldset>');
  return parts.join('\n');
}

/**
 * The page script. Serialized with toString and run in the browser, so it may
 * use only its two arguments and browser globals.
 */
function clientMain(formatAnswerBlock, buildAnswerJson) {
  const main = document.querySelector('main');
  const formId = main.dataset.formId;
  const title = main.dataset.title;
  const storeKey = `topia-decision-form:${formId}`;
  const sets = Array.from(document.querySelectorAll('fieldset.decision'));
  const status = document.getElementById('status');
  const counter = document.getElementById('counter');
  const outWrap = document.getElementById('out-wrap');
  const out = document.getElementById('out');

  const choiceOf = (fs) => {
    const sel = fs.querySelector('select');
    if (sel) return sel.value;
    const r = fs.querySelector('input[type="radio"]:checked');
    return r ? r.value : fs.dataset.default;
  };
  const setChoice = (fs, value) => {
    const sel = fs.querySelector('select');
    if (sel) {
      if (Array.from(sel.options).some((o) => o.value === value)) sel.value = value;
      return;
    }
    for (const r of fs.querySelectorAll('input[type="radio"]')) r.checked = r.value === value;
  };
  const collect = () =>
    sets.map((fs) => {
      const choice = choiceOf(fs);
      const note = fs.querySelector('textarea');
      return {
        id: fs.dataset.id,
        choice,
        status: choice === fs.dataset.default ? 'default' : 'changed',
        note: note ? note.value.trim() : '',
      };
    });
  const say = (msg) => {
    status.textContent = msg;
  };
  const save = (answers) => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(answers));
    } catch {
      // Storage can be off for file:// pages. The form still works.
    }
  };
  const refresh = () => {
    const answers = collect();
    let changed = 0;
    answers.forEach((a, i) => {
      const isChanged = a.status === 'changed';
      sets[i].dataset.changed = String(isChanged);
      if (isChanged) changed++;
    });
    counter.textContent = `${changed} of ${answers.length} changed from the recommendation.`;
    save(answers);
  };
  const restore = () => {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
    } catch {
      saved = null;
    }
    if (!Array.isArray(saved)) return;
    for (const a of saved) {
      const fs = sets.find((s) => s.dataset.id === a.id);
      if (!fs) continue;
      setChoice(fs, a.choice);
      const note = fs.querySelector('textarea');
      if (note && a.note) {
        note.value = a.note;
        fs.querySelector('details').open = true;
      }
    }
  };
  const showBlock = (block) => {
    outWrap.hidden = false;
    out.value = block;
  };
  const execCopy = () => {
    out.focus();
    out.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  };
  const copied = () => say('Copied. Paste it into the chat.');
  const manual = () => {
    out.focus();
    out.select();
    say('Could not copy automatically. The block below is selected: press Ctrl+C (Cmd+C on a Mac), or use a download.');
  };
  const download = (name, type, body) => {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say(`Saved ${name}. Paste its contents into the chat.`);
  };

  document.getElementById('copy').addEventListener('click', () => {
    const block = formatAnswerBlock(formId, collect());
    showBlock(block);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(block).then(copied, () => (execCopy() ? copied() : manual()));
    } else if (execCopy()) {
      copied();
    } else {
      manual();
    }
  });
  document.getElementById('dl-md').addEventListener('click', () => {
    const block = formatAnswerBlock(formId, collect());
    showBlock(block);
    const fence = '```';
    const md = `# ${title} — answers\n\nPaste this block into the chat.\n\n${fence}text\n${block}\n${fence}\n`;
    download(`${formId}-answers.md`, 'text/markdown', md);
  });
  document.getElementById('dl-json').addEventListener('click', () => {
    const json = `${JSON.stringify(buildAnswerJson(formId, collect()), null, 2)}\n`;
    showBlock(formatAnswerBlock(formId, collect()));
    download(`${formId}-answers.json`, 'application/json', json);
  });
  document.getElementById('reset').addEventListener('click', () => {
    for (const fs of sets) {
      setChoice(fs, fs.dataset.default);
      const note = fs.querySelector('textarea');
      if (note) note.value = '';
    }
    refresh();
    say('Back to the recommended answers.');
  });
  document.addEventListener('change', refresh);
  document.addEventListener('input', refresh);
  restore();
  refresh();
}

/**
 * Render the full HTML page for a spec (raw or normalized).
 * @param {object} rawSpec
 * @param {{generatedAt?: string}} [opts]
 */
export function renderFormHtml(rawSpec, opts = {}) {
  const spec = normalizeSpec(rawSpec);
  const e = escapeHtml;
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const body = [];
  let group = '';
  spec.decisions.forEach((d, i) => {
    if (d.group && d.group !== group) {
      body.push(`<h2>${e(d.group)}</h2>`);
      group = d.group;
    }
    body.push(renderDecision(d, i + 1));
  });
  const script = `(${clientMain.toString()})(${formatAnswerBlock.toString()}, ${buildAnswerJson.toString()});`;
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="generator" content="topia decision-form ${VERSION}">
<title>${e(spec.title)}</title>
<style>
${BASE_CSS}
${FORM_CSS}
</style>
</head>
<body>
<main data-form-id="${e(spec.id)}" data-title="${e(spec.title)}">
<h1>${e(spec.title)}</h1>
${paragraphs(spec.intro)}
<div class="how">
<p><strong>How to answer.</strong> The recommended option is already picked for each of the ${spec.decisions.length} decisions. Change the ones you disagree with. Add a note where it helps. Then press <strong>Copy answers</strong> and paste the block into the chat.</p>
</div>
<div id="decisions">
${body.join('\n')}
<div id="out-wrap" hidden>
<label for="out">Answer block</label>
<textarea id="out" class="mono" readonly rows="8" spellcheck="false"></textarea>
</div>
<div class="actions">
<p id="counter" aria-live="polite"></p>
<button type="button" class="primary" id="copy">Copy answers</button>
<button type="button" id="dl-md">Download .md</button>
<button type="button" id="dl-json">Download .json</button>
<button type="button" id="reset">Reset to recommended</button>
<p id="status" role="status" aria-live="polite"></p>
</div>
</div>
<p class="muted">Form <code>${e(spec.id)}</code> · made ${e(generatedAt.slice(0, 10))}. Nothing on this page goes over the network.</p>
</main>
<script>
${script}
</script>
</body>
</html>
`;
}

// ── CLI ───────────────────────────────────────────────────────────────────

const HELP = `decision-form ${VERSION}: build a one-file HTML decision form, or parse its answers.

Usage:
  node decision-form.js --spec <spec.json|-> [--out-dir <dir>] [--root <dir>] [--json] [--dry-run] [--debug]
  node decision-form.js --parse <answers.txt|-> [--spec <spec.json>] [--out-dir <dir>] [--json]
  node decision-form.js --help | --version | --smoke

Build writes <out-dir>/<form-id>.html and <form-id>.spec.json, then prints both paths.
Out dir: --out-dir, else $DECISION_FORM_OUT_DIR, else the OpenClaw dirs, else <root>/.topia/decision-form/.
--parse reads a pasted TOPIA-DECISIONS block, or the .md/.json download. It checks ids and
options against --spec, or against <out-dir>/<form-id>.spec.json when that file exists.

Exit codes: 0 ok, 1 could not read or write a file, 2 usage error, 3 invalid spec or answer block.`;

export function resolveOutDir(flag, env, root) {
  if (flag) return path.resolve(root, flag);
  if (env.DECISION_FORM_OUT_DIR) return path.resolve(root, env.DECISION_FORM_OUT_DIR);
  if (env.OPENCLAW_OUTPUT_DIR) return path.resolve(root, env.OPENCLAW_OUTPUT_DIR);
  if (env.OPENCLAW_AGENT_DIR) return path.join(env.OPENCLAW_AGENT_DIR, 'artifacts', 'decision-form');
  if (env.OPENCLAW_STATE_DIR) return path.join(env.OPENCLAW_STATE_DIR, 'artifacts', 'decision-form');
  return path.join(root, '.topia', 'decision-form');
}

/** true = git ignores the path, false = it would be committed, null = not a git repo or no git. */
export function isGitIgnored(root, file) {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: root, stdio: 'ignore' });
    return true;
  } catch (err) {
    return err.status === 1 ? false : null;
  }
}

function readInput(source, cwd) {
  return source === '-' ? readFileSync(0, 'utf8') : readFileSync(path.resolve(cwd, source), 'utf8');
}

class UsageError extends Error {}

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
        parse: { type: 'string' },
        'out-dir': { type: 'string' },
        root: { type: 'string' },
        json: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        debug: { type: 'boolean', default: false },
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
  const trace = [];
  const debug = (event, data = {}) => {
    if (!values.debug) return;
    const entry = { t: new Date().toISOString(), event, ...data };
    trace.push(entry);
    stderr.write(`[debug] ${event} ${JSON.stringify(data)}\n`);
  };

  if (values.smoke) {
    const [major] = process.versions.node.split('.').map(Number);
    const ok = major >= 18;
    stderr.write(ok ? `ok: node ${process.versions.node}, out dir ${outDir}\n` : 'node 18 or newer is required\n');
    return ok ? 0 : 1;
  }

  try {
    if (values.parse) return runParse(values, outDir, { cwd, stdout, stderr, debug });
    if (values.spec) return runBuild(values, root, outDir, { cwd, stdout, stderr, debug, trace });
    throw new UsageError('Pass --spec <file> to build a form, or --parse <file> to read answers.');
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(`${err.message}\n\n${HELP}\n`);
      return 2;
    }
    if (err instanceof SpecError || err instanceof AnswerBlockError) {
      stderr.write(`${err.message}\n`);
      return 3;
    }
    stderr.write(`${err.message}\n`);
    return 1;
  }
}

function runBuild(values, root, outDir, { cwd, stdout, stderr, debug, trace }) {
  let raw;
  try {
    raw = JSON.parse(readInput(values.spec, cwd));
  } catch (err) {
    if (err instanceof SyntaxError) throw new SpecError([`spec is not valid JSON: ${err.message}`]);
    throw err;
  }
  const spec = normalizeSpec(raw);
  debug('spec.ok', { id: spec.id, decisions: spec.decisions.length });
  const htmlPath = path.join(outDir, `${spec.id}.html`);
  const specPath = path.join(outDir, `${spec.id}.spec.json`);
  const html = renderFormHtml(spec);
  const ignored = isGitIgnored(root, htmlPath);
  if (ignored === false) {
    stderr.write(
      `warning: git would commit ${path.relative(root, htmlPath)}. Add "/.topia/*" to .gitignore (topia doctor checks this).\n`,
    );
  }
  const summary = {
    status: values['dry-run'] ? 'dry-run' : 'written',
    formId: spec.id,
    decisions: spec.decisions.length,
    html: htmlPath,
    url: pathToFileURL(htmlPath).href,
    spec: specPath,
    gitIgnored: ignored,
  };
  if (!values['dry-run']) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(htmlPath, html, 'utf8');
    writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
    debug('written', { html: htmlPath, bytes: Buffer.byteLength(html) });
    if (values.debug) {
      appendFileSync(path.join(outDir, `${spec.id}.jsonl`), `${trace.map((t) => JSON.stringify(t)).join('\n')}\n`);
    }
  }
  stdout.write(values.json ? `${JSON.stringify(summary, null, 2)}\n` : `${htmlPath}\n${specPath}\n`);
  return 0;
}

function runParse(values, outDir, { cwd, stdout, stderr, debug }) {
  const input = readInput(values.parse, cwd);
  let spec = null;
  if (values.spec) {
    spec = JSON.parse(readInput(values.spec, cwd));
  } else {
    const loose = parseAnswers(input);
    const guess = path.join(outDir, `${loose.formId}.spec.json`);
    if (existsSync(guess)) spec = JSON.parse(readFileSync(guess, 'utf8'));
    debug('spec.lookup', { path: guess, found: Boolean(spec) });
  }
  const result = parseAnswers(input, spec ?? undefined);
  for (const w of result.warnings) stderr.write(`warning: ${w}\n`);
  if (!spec) stderr.write('note: no spec found, so ids and options were not checked\n');
  if (values.json) {
    stdout.write(`${JSON.stringify({ ...result, checkedAgainstSpec: Boolean(spec) }, null, 2)}\n`);
  } else {
    for (const a of result.answers) {
      const label = a.label ? ` (${a.label})` : '';
      const note = a.note ? `  note: ${a.note}` : '';
      stdout.write(`${a.id} = ${a.choice}${label} [${a.status}]${note}\n`);
    }
  }
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = run(process.argv.slice(2));
