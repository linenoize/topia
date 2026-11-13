// Topia hook runner — loads and executes named hook modules
//
// Run as `node run-hook.cjs <hook>`, or from Cursor plugin hooks as
// `node -e "require(<plugin>/hooks/run-hook.cjs)" <hook>`. Under `node -e`
// there is no script path in argv, so the hook name is argv[1].
const fs = require('fs');
const path = require('path');

const hookName = require.main ? process.argv[2] : process.argv[1];
if (!hookName) {
  console.error('Usage: run-hook <hook-name>');
  process.exit(1);
}

// Cursor runs plugin hooks from the plugin folder, not the project. Hooks keep
// their state in <project>/.topia, so move to the project first.
// https://cursor.com/docs/hooks (working directory, CURSOR_PROJECT_DIR)
const cursorProject = process.env.CURSOR_PLUGIN_ROOT && process.env.CURSOR_PROJECT_DIR;
if (cursorProject) {
  try {
    if (fs.statSync(cursorProject).isDirectory()) process.chdir(cursorProject);
  } catch {
    // Stay where we are.
  }
}

const hookPath = path.join(__dirname, hookName, 'index.cjs');
try {
  require(hookPath);
} catch (e) {
  console.error(`Topia hook "${hookName}" failed: ${e.message}`);
  process.exit(1);
}
