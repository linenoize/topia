// Topia Intent Router Hook — UserPromptSubmit
// Names the Topia skill a prompt's wording points at, for the model to weigh.
//
// Scores against hooks/lib/skill-routes.json, which ships with the plugin
// (written by `npm run generate:slash-aliases` from compiler/lib/intent-keywords.js),
// with the same scorer as the prompt-routing mod (hooks/lib/prompt-routing.cjs).
// Where that mod is loaded it shows the reading above the prompt and drops
// this block, so the model reads it once.
//
// Runs synchronously (hooks.json, short timeout) so the hint lands with the
// prompt it was made for; a background hook's output arrives a turn late.
// The hint goes out as JSON `hookSpecificOutput.additionalContext`, the
// documented way for a UserPromptSubmit hook to add context
// (https://code.claude.com/docs/en/hooks). Each hint is logged, without the
// prompt, to .topia/metrics/routing.jsonl (hooks/lib/routing-log.cjs).

const { isCursorRuntime } = require('../lib/cursor-io.cjs');
const { formatBareSlashRedirect, matchBareTopiaSlash } = require('../lib/skill-catalog.cjs');

function say(text) {
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } })}\n`,
  );
}

function log(session, skills, bare) {
  try {
    const ms = performance.now();
    require('../lib/routing-log.cjs').appendRouting(process.cwd(), { session, skills, ms, bare });
  } catch {
    // Fail silently: the log never blocks a prompt.
  }
}

function route(input) {
  let userPrompt = '';
  let session = null;
  let event = {};
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === 'object') event = parsed;
    userPrompt = event.user_prompt || event.prompt || event.content || '';
    if (typeof event.session_id === 'string') session = event.session_id;
  } catch {
    // Raw text input
    userPrompt = input.trim();
  }

  if (typeof userPrompt !== 'string' || userPrompt.length < 3) return;
  // Cursor builds its own routing rules; stay silent there.
  if (isCursorRuntime(event)) return;

  const bareSkill = matchBareTopiaSlash(userPrompt);
  if (bareSkill) {
    say(`⚠️  ${formatBareSlashRedirect(bareSkill)}`);
    log(session, [bareSkill], true);
    return;
  }

  try {
    const { predict, formatSuggestion } = require('../lib/prompt-routing.cjs');
    const prediction = predict(userPrompt);
    const suggestion = formatSuggestion(prediction);
    if (suggestion) {
      say(suggestion);
      log(
        session,
        prediction.skills.map((skill) => skill.name),
        false,
      );
    }
  } catch {
    // Fail open: a missing or broken table never blocks a prompt.
  }
}

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  route(input);
  process.exitCode = 0;
});
