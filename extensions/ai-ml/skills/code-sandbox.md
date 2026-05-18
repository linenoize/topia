---
name: "code-sandbox"
pack: "@Topia/ai-ml"
description: "Secure code execution for AI agents — sandboxed environments for running LLM-generated code safely with container isolation, resource limits, and timeout enforcement."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# code-sandbox

Secure code execution for AI agents — sandboxed environments for running LLM-generated code safely. Covers container isolation, resource limits, timeout enforcement, file system boundaries, and output capture for code interpreter, CI/CD, and interactive development use cases.

#### Workflow

**Step 1 — Assess execution requirements**
Determine what kind of code the agent needs to run:

| Use Case | Isolation Level | Runtime |
|---|---|---|
| Code interpreter (data analysis, math) | High — untrusted code | Python + pandas/numpy |
| Build/test pipeline | Medium — project code | Node.js / Python with project deps |
| Interactive preview (web app) | Medium — expose HTTP port | Node.js + browser preview |
| Shell commands (file ops, git) | Low — trusted context | System shell with path restrictions |

**Step 2 — Configure sandbox environment**
Emit sandbox configuration based on use case:

```typescript
// Sandbox factory — select isolation level by use case
interface SandboxConfig {
  language: 'python' | 'javascript' | 'typescript';
  timeout: number;       // max execution time in ms
  memoryLimit: number;   // max memory in MB
  networkAccess: boolean;
  fileSystemRoot: string;  // restricted working directory
  allowedModules: string[];
}

const SANDBOX_PRESETS: Record<string, SandboxConfig> = {
  'code-interpreter': {
    language: 'python',
    timeout: 30_000,
    memoryLimit: 256,
    networkAccess: false,
    fileSystemRoot: '/workspace',
    allowedModules: ['pandas', 'numpy', 'matplotlib', 'scipy', 'json', 'csv', 'math'],
  },
  'build-test': {
    language: 'typescript',
    timeout: 120_000,
    memoryLimit: 512,
    networkAccess: true,  // needs npm registry
    fileSystemRoot: '/project',
    allowedModules: ['*'],  // project dependencies
  },
  'preview': {
    language: 'javascript',
    timeout: 300_000,
    memoryLimit: 256,
    networkAccess: true,
    fileSystemRoot: '/app',
    allowedModules: ['*'],
  },
};
```

**Step 3 — Implement execution with resource limits**
Emit code execution wrapper with safety boundaries:

```typescript
// Docker-based sandbox execution
import { spawn } from 'child_process';

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

async function executeInSandbox(
  code: string,
  config: SandboxConfig
): Promise<ExecutionResult> {
  const start = Date.now();

  // Write code to temp file in sandbox root
  const codePath = `${config.fileSystemRoot}/run.${config.language === 'python' ? 'py' : 'ts'}`;
  await writeFile(codePath, code);

  const proc = spawn('docker', [
    'run', '--rm',
    '--memory', `${config.memoryLimit}m`,
    '--cpus', '1',
    '--network', config.networkAccess ? 'bridge' : 'none',
    '--read-only',
    '--tmpfs', '/tmp:size=64m',
    '-v', `${config.fileSystemRoot}:/workspace:ro`,
    '-w', '/workspace',
    `sandbox-${config.language}:latest`,
    config.language === 'python' ? 'python' : 'npx tsx',
    `/workspace/run.${config.language === 'python' ? 'py' : 'ts'}`,
  ]);

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGKILL');
  }, config.timeout);

  const exitCode = await new Promise<number>((resolve) => {
    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });

  return { stdout, stderr, exitCode, durationMs: Date.now() - start, timedOut };
}
```

**Step 4 — Code interpreter mode (stateful sessions)**
For multi-turn code execution where variables persist between runs:

```typescript
// Stateful code interpreter — variables persist across executions
interface CodeSession {
  id: string;
  language: 'python' | 'javascript';
  history: { code: string; result: ExecutionResult }[];
}

async function runInSession(
  session: CodeSession,
  code: string
): Promise<ExecutionResult> {
  // Python: use exec() with persistent globals dict
  // JavaScript: use Node.js vm module with persistent context
  const wrappedCode = session.language === 'python'
    ? `exec(${JSON.stringify(code)}, _globals)`
    : code;

  const result = await executeInSandbox(wrappedCode, SANDBOX_PRESETS['code-interpreter']);

  // Append to history (immutable update)
  session.history = [...session.history, { code, result }];

  return result;
}

// Rich output capture — not just stdout
interface RichOutput {
  text?: string;
  images?: { data: string; mimeType: string }[];  // base64 encoded
  tables?: { headers: string[]; rows: string[][] }[];
  error?: string;
}
```

**Step 5 — Security boundaries**
Enforce isolation guarantees:

| Boundary | Enforcement |
|---|---|
| File system | Read-only mount + tmpfs for temp files. No access to host filesystem. |
| Network | `--network none` for code interpreter. Whitelist for build/test. |
| Memory | Docker `--memory` limit. OOM killed if exceeded. |
| CPU | Docker `--cpus` limit. Prevents crypto mining / infinite loops. |
| Time | Kill process after timeout. Return partial output. |
| Secrets | Never mount env vars or secrets into sandbox container. |
| Output size | Cap stdout/stderr at 1MB. Truncate with `[output truncated]` marker. |

#### Sharp Edges

| Failure Mode | Mitigation |
|---|---|
| Sandbox escape via Docker vulnerability | Pin Docker version; use rootless Docker; consider gVisor/Firecracker for high-security |
| Code writes to /tmp exhausting disk | Use `--tmpfs` with size limit (64MB default) |
| Infinite loop inside sandbox hangs API | Hard timeout with SIGKILL — never rely on SIGTERM alone |
| Stateful session grows unbounded memory | Limit session history to last 50 executions; reset context on overflow |
