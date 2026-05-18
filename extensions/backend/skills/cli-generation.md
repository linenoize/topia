---
name: "cli-generation"
pack: "@Topia/backend"
description: "Generate production-grade CLI wrappers for backend services — command groups, dual output mode (human + JSON), stateful REPL, session management with undo/redo, and pip/npm-installable packaging."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# cli-generation

Generate production-grade CLI wrappers for backend services — command groups, dual output mode (human + JSON), stateful REPL, session management with undo/redo, and pip/npm-installable packaging.

#### Workflow

**Step 1 — Analyze backend service surface**
Map existing API endpoints, service methods, or data models to CLI command groups:
```typescript
interface CLICommandGroup {
  name: string;          // e.g., 'users', 'orders', 'config'
  source: string;        // API route file or service class
  commands: CLICommand[];
}

interface CLICommand {
  name: string;          // e.g., 'list', 'create', 'delete'
  sourceMethod: string;  // e.g., 'UserService.findAll'
  params: CLIParam[];
  mutating: boolean;     // true = needs confirmation/undo support
}
```

**Step 2 — Design dual output mode**
Every command MUST support both human-readable and machine-readable output:
```typescript
// Human mode (default): tables, colors, formatted text
function formatHuman(data: any, format: 'table' | 'list' | 'detail'): string {
  if (format === 'table') return formatTable(data, { borders: true, colors: true });
  if (format === 'list') return data.map((d: any) => `  • ${d.name}`).join('\n');
  return JSON.stringify(data, null, 2);
}

// JSON mode (--json flag): structured output for piping/scripting
function formatJSON(data: any): string {
  return JSON.stringify(data, null, 2);
}

// Error output follows same dual pattern
function formatError(error: Error, jsonMode: boolean): string {
  if (jsonMode) return JSON.stringify({ error: error.message, type: error.constructor.name });
  return chalk.red(`Error: ${error.message}`);
}
```

**Step 3 — Implement session with undo/redo**
For mutating operations, maintain session state:
```typescript
interface CLISession {
  id: string;
  history: SessionSnapshot[];
  undoStack: SessionSnapshot[];   // max 50
  redoStack: SessionSnapshot[];
  modified: boolean;
}

function snapshot(session: CLISession, action: string): CLISession {
  return {
    ...session,
    undoStack: [...session.undoStack.slice(-49), { action, state: deepCopy(session) }],
    redoStack: [],  // new action clears redo
    modified: true,
  };
}
```

**Step 4 — Build REPL mode**
CLI enters REPL when invoked without subcommand:
```typescript
// Click (Python) — invoke_without_command=True enters REPL
@click.group(invoke_without_command=True)
@click.pass_context
def cli(ctx):
    if ctx.invoked_subcommand is None:
        start_repl(ctx)

// Commander (Node.js) — detect no args
if (process.argv.length <= 2) {
  startREPL({ history: '~/.myapp_history', prompt: 'myapp> ' });
}
```

REPL features: command history (file-persisted), auto-suggest from history, tab completion, colored prompt, help command, status bar showing connection state.

**Step 5 — Package for distribution**
```bash
# Python: PEP 420 namespace packages for independent installability
# pyproject.toml or setup.py
entry_points = {
    'console_scripts': ['myapp = myapp.cli:main'],
}

# Node.js: bin field in package.json
{
  "bin": { "myapp": "./bin/cli.js" },
  "files": ["bin/", "lib/"]
}
```

**Step 6 — Verify installation**
After packaging: install locally (`pip install -e .` or `npm link`), verify binary on PATH (`which myapp`), run `myapp --version`, test `myapp --json` mode, and verify REPL launch.

#### Example

```python
# Generated CLI structure for a backend service
# myapp/
# ├── cli.py          ← Click entry point + REPL
# ├── commands/
# │   ├── users.py    ← User CRUD commands
# │   ├── orders.py   ← Order management
# │   └── config.py   ← Config operations
# ├── core/
# │   ├── session.py  ← Session + undo/redo
# │   └── client.py   ← API client wrapper
# └── utils/
#     ├── output.py   ← Dual output (human + JSON)
#     └── repl.py     ← REPL with prompt-toolkit

# Usage:
# myapp users list                    → human-readable table
# myapp users list --json             → JSON output for piping
# myapp users create --name "Alice"   → creates user, snapshots for undo
# myapp                               → enters REPL mode
```
