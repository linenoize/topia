// Topia Intent Router Hook — UserPromptSubmit
// Names the Topia skill a prompt's wording points at, for the model to weigh.
//
// Scores against hooks/lib/skill-routes.json, which ships with the plugin
// (written by `npm run generate:slash-aliases` from compiler/lib/intent-keywords.js),
// with the same scorer as the prompt-routing mod (hooks/lib/prompt-routing.cjs).
// Where that mod is loaded it shows the reading above the prompt and drops
// this block, so the model reads it once.

const { isCursorRuntime } = require('../lib/cursor-io.cjs');
const { formatBareSlashRedirect, matchBareTopiaSlash } = require('../lib/skill-catalog.cjs');

// Cursor wants JSON on stdout and builds its own routing rules; stay silent there.
function say(text) {
  if (!isCursorRuntime()) console.log(`\n${text}\n`);
}

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  let userPrompt = '';
  try {
    const parsed = JSON.parse(input);
    userPrompt = parsed.user_prompt || parsed.prompt || parsed.content || '';
  } catch {
    // Raw text input
    userPrompt = input.trim();
  }

  if (typeof userPrompt !== 'string' || userPrompt.length < 3) process.exit(0);

  const bareSkill = matchBareTopiaSlash(userPrompt);
  if (bareSkill) {
    say(`⚠️  ${formatBareSlashRedirect(bareSkill)}`);
    process.exit(0);
  }

  try {
    const { predict, formatSuggestion } = require('../lib/prompt-routing.cjs');
    const suggestion = formatSuggestion(predict(userPrompt));
    if (suggestion) say(suggestion);
  } catch {
    // Fail open: a missing or broken table never blocks a prompt.
  }

  process.exit(0);
});
