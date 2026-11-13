// Finds a project's own copy of a Node tool (prettier, typescript), so hooks
// run only what the project already installed. Never npx: npx downloads a
// package when the project has none, which is slow and runs code the project
// did not choose.

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// The nearest folder at or above `start` whose package.json lists `pkg` as a
// dependency or devDependency and has it installed in node_modules.
// Returns { root, script } with the tool's bin script, or null.
function findLocalTool(start, pkg, binName = pkg) {
  let dir = path.resolve(start);
  for (let i = 0; i < 40; i++) {
    const manifest = readJson(path.join(dir, 'package.json'));
    if (manifest) {
      const listed = (manifest.dependencies && manifest.dependencies[pkg]) || (manifest.devDependencies && manifest.devDependencies[pkg]);
      if (listed) {
        const pkgDir = path.join(dir, 'node_modules', pkg);
        const toolManifest = readJson(path.join(pkgDir, 'package.json'));
        if (toolManifest) {
          const bin = typeof toolManifest.bin === 'string' ? toolManifest.bin : toolManifest.bin && toolManifest.bin[binName];
          if (bin && fs.existsSync(path.join(pkgDir, bin))) return { root: dir, script: path.join(pkgDir, bin) };
        }
        return null; // Listed but not installed: nothing to run.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Hook input arrives as JSON on stdin. Claude Code never sets CLAUDE_TOOL_INPUT.
function readEvent() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw.trim()) return JSON.parse(raw);
  } catch {
    // No stdin or not JSON.
  }
  return {};
}

function editedFile(event) {
  const input = event.tool_input || event.toolInput || {};
  // Claude Code: tool_input.file_path. Cursor afterFileEdit: file_path at the top level.
  const file = input.file_path || input.filePath || event.file_path || '';
  if (!file) return '';
  const cwd = typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd();
  return path.resolve(cwd, file);
}

module.exports = { findLocalTool, readEvent, editedFile };
