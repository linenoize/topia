/**
 * Contract section 10. A speed bump, not a boundary. It catches accidents and
 * casual injection: a command spelled through a variable, or written to a script
 * and run later, goes straight past it. The hard limit is a Salesforce user that
 * can't write. No Node here: the mod runs this inside a tool.check hook.
 */

export const GUARD_SOURCE = '[topia salesforce guard]'

/** What the person-gated tools ask the chain about, to learn whether this guard is still in it. */
export const GUARD_PROBE_LINE = 'sf org list --json'

export type ShellScope = { activated: boolean }
export type FileScope = { activated: boolean; isWrite: boolean }

const WRAPPERS = new Set([
  'sudo', 'gsudo', 'doas', 'stdbuf', 'setsid', 'ionice', 'chrt', 'taskset', 'watch', 'parallel', 'npm', 'pnpm', 'yarn', 'env', 'command', 'builtin', 'exec', 'time', 'nice', 'nohup', 'timeout', 'xargs', 'call', 'start', 'eval', 'iex', 'invoke-expression', 'start-process', 'saps', '.', 'npx', 'pnpx', 'bunx', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '!',
  'cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'dash', 'wsl', 'node', 'bun', 'deno', 'tsx', 'python', 'python3', 'py', 'ruby', 'perl', 'php',
])
/** After these, the words `x`, `exec`, `run` and `dlx` still name a runner and not the command. `bun x sf` runs sf. */
const RUNNER_WORDS = new Set(['x', 'exec', 'run', 'dlx'])
const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'dash', 'wsl', 'eval', 'iex', 'invoke-expression'])
const INTERPRETERS = new Set(['node', 'bun', 'deno', 'tsx', 'python', 'python3', 'py', 'ruby', 'perl', 'php'])
const SCRIPT_FLAGS = new Set(['-c', '/c', '/k', '-command', '-e', '--eval', '-p', '--print'])

const CLI_NAMES = new Set(['sf', 'sfdx'])

const NETWORK_COMMANDS = new Set(['curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'sftp', 'ftp', 'rsync', 'telnet', 'socat', 'gh', 'hub', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'start-bitstransfer', 'bitsadmin', 'certutil', 'aria2c', 'http', 'https', 'xh'])
const NETWORK_GIT = new Set(['push', 'pull', 'fetch', 'clone', 'remote', 'ls-remote', 'submodule'])
const NETWORK_TEXT = /[a-z][a-z0-9+.-]*:\/\/|\/dev\/(?:tcp|udp)\/|net\.webclient|net\.http|httpclient|net\.sockets|\bfetch\s*\(|\brequests\.|\burllib|\bhttp\.(?:get|post|request)|\bsocket\b|\baxios\b|xmlhttprequest/i

function basename(word: string): string {
  const parts = word.split(/[\\/]/)
  return (parts[parts.length - 1] ?? '').toLowerCase().replace(/\.(?:cmd|exe|bat|ps1|sh)$/, '')
}

type Words = string[]

/**
 * Splits a line into commands, then words, with quotes and escapes resolved. It
 * knows just enough shell to find what's in command position. Backslash and
 * backtick mean different things in Bash and PowerShell, and either tool can run
 * either spelling on Windows, so each line is read both ways.
 */
function tokenize(line: string, escape: '\\' | '`'): Words[] {
  const commands: Words[] = [[]]
  let word = ''
  let inWord = false
  let quote: string | null = null
  const endWord = () => {
    if (inWord) (commands[commands.length - 1] as Words).push(word)
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    commands.push([])
  }
  for (let at = 0; at < line.length; at += 1) {
    const char = line.charAt(at)
    const next = line.charAt(at + 1)
    if (quote === "'") {
      if (char === "'") quote = null
      else word += char
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = null
      else if (char === escape && (next === '"' || next === escape || next === '$')) {
        word += next
        at += 1
      } else word += char
      continue
    }
    if (char === escape && next !== '') {
      word += next
      inWord = true
      at += 1
    } else if (char === "'" || char === '"') {
      quote = char
      inWord = true
    } else if (char === '$' && next === '(') {
      endCommand()
      at += 1
    } else if (char === ';' || char === '|' || char === '&' || char === '\n' || char === '\r' || char === '(' || char === ')' || char === '{' || char === '}' || char === '`') {
      endCommand()
    } else if (char === ' ' || char === '\t') {
      endWord()
    } else {
      word += char
      inWord = true
    }
  }
  endWord()
  return commands.filter(words => words.length > 0)
}

const ASSIGNMENT = /^(?:\$env:)?[A-Za-z_][A-Za-z0-9_]*=/

type Scan = { commands: string[]; scripts: string[]; flat: string[] }

/** Walks past wrappers to what actually runs. A wrapper's script argument is a line of its own, so it is read again. */
function scanWords(words: Words, into: Scan): void {
  into.flat.push(words.join(' '))
  let at = 0
  let wrapper: string | null = null
  while (at < words.length) {
    const word = words[at] as string
    if (ASSIGNMENT.test(word)) {
      at += 1
      continue
    }
    const name = basename(word)
    const lowered = word.toLowerCase()
    if (wrapper !== null && (lowered.startsWith('-') || lowered.startsWith('/') || /^\d+[smh]?$/.test(word))) {
      if (SCRIPT_FLAGS.has(lowered)) {
        const script = words.slice(at + 1).join(' ')
        if (script.length > 0) into.scripts.push(script)
        if (INTERPRETERS.has(wrapper)) into.flat.push(script)
        return
      }
      // A flag that takes a value, like `sudo -u ada`, has its value skipped with it when the next word can't be a command.
      if (/^-[a-z]$/.test(lowered) && wrapper === 'sudo') at += 1
      at += 1
      continue
    }
    if ((wrapper === 'bun' || wrapper === 'deno') && RUNNER_WORDS.has(lowered)) {
      at += 1
      continue
    }
    if (WRAPPERS.has(name) && !(wrapper !== null && INTERPRETERS.has(wrapper))) {
      wrapper = name
      if (name === 'eval' || name === 'iex' || name === 'invoke-expression') {
        const script = words.slice(at + 1).join(' ')
        if (script.length > 0) into.scripts.push(script)
        return
      }
      at += 1
      continue
    }
    into.commands.push(word)
    break
  }
  for (const [index, word] of words.entries()) {
    const lowered = word.toLowerCase()
    if ((lowered === '-exec' || lowered === '-execdir' || lowered === '-ok') && words[index + 1] !== undefined) into.commands.push(words[index + 1] as string)
  }
}

const SUBSTITUTION = /\$\(([^()]*)\)|`([^`]*)`/g

function scanLine(line: string, depth = 0): Scan {
  const into: Scan = { commands: [], scripts: [], flat: [] }
  for (const escape of ['\\', '`'] as const) for (const words of tokenize(line, escape)) scanWords(words, into)
  if (depth < 4) {
    for (const match of line.matchAll(SUBSTITUTION)) {
      const text = match[1] ?? match[2] ?? ''
      // `$(echo sf) org list` runs what echo prints, so the words it prints are read as command words.
      for (const words of tokenize(text, '\\')) if (['echo', 'printf'].includes(basename(words[0] ?? ''))) into.commands.push(...words.slice(1))
      const inner = scanLine(text, depth + 1)
      into.commands.push(...inner.commands)
      into.scripts.push(...inner.scripts)
      into.flat.push(...inner.flat)
    }
    for (const script of [...into.scripts]) {
      const inner = scanLine(script, depth + 1)
      into.commands.push(...inner.commands)
      into.flat.push(...inner.flat)
      into.scripts.push(...inner.scripts)
    }
  }
  return into
}

/** The same spelling rules for a shell line and a path: lower case, forward slashes, no quotes. */
function flatten(text: string): string {
  return text.toLowerCase().replace(/\\/g, '/').replace(/['"`]/g, '')
}

const PATH_END = '(?:$|[\\s;&|)>,])'
const PATH_START = '(?:^|[^a-z0-9_.-])'

type Rule = { pattern: RegExp; named: string }

/**
 * These could turn a project on, so they apply whether or not it's on yet. They are kept narrow, because they reach
 * someone who has never used Salesforce: a `runner.js`, a `cli.js` or an `activation.ts` of their own goes by.
 * Each one needs the words that turn a project on, or a name only the store has.
 */
const ALWAYS_RULES: Rule[] = [
  { pattern: new RegExp(`${PATH_START}runner\\.js\\s+(?:enable|disable)${PATH_END}`), named: 'the Salesforce runner' },
  { pattern: new RegExp(`${PATH_START}cli\\.js\\s+(?:enable|disable)${PATH_END}`), named: "the Salesforce service's command line" },
  // The three names the store has: its file, its logs and its local folder. Not any word that begins with them.
  { pattern: /topia-salesforce(?:\.json|-logs|-local)(?:$|[^a-z0-9_])/, named: "the Salesforce service's store" },
  // Code run with `node -e` can import the activation module and turn a project on without ever spelling the store's name.
  { pattern: new RegExp(`\\b(?:require|import)\\b.*${PATH_START}activation\\.(?:js|ts)${PATH_END}`), named: "the Salesforce service's activation code" },
]

const ACTIVATED_RULES: Rule[] = [
  // In a project that is on, any mention of these is the service, and the narrower forms above are not enough.
  { pattern: new RegExp(`${PATH_START}runner\\.js${PATH_END}`), named: 'the Salesforce runner' },
  { pattern: new RegExp(`${PATH_START}activation\\.(?:js|ts)${PATH_END}`), named: "the Salesforce service's activation code" },
  { pattern: /topia-salesforce/, named: "the Salesforce service's store" },
  { pattern: new RegExp(`${PATH_START}\\.sfdx(?:$|[^a-z0-9_.-])`), named: 'the Salesforce CLI login folder (.sfdx)' },
  { pattern: new RegExp(`${PATH_START}\\.sf(?:$|[\\s;&|)>,/])`), named: 'the Salesforce CLI config folder (.sf)' },
  { pattern: /@salesforce\/cli/, named: 'the Salesforce CLI package' },
  { pattern: new RegExp(`(?:^|[\\s/])run\\.js${PATH_END}`), named: 'the Salesforce CLI entry point (run.js)' },
  { pattern: /salesforce\/service/, named: "the Salesforce service's code" },
  { pattern: /plugins\/store/, named: 'the plugin store' },
  { pattern: /\.claude\/settings/, named: 'Claude Code settings' },
]

/** Code run with `node -e` or `python -c` names the CLI as a quoted word. */
const QUOTED_CLI = /(?:^|['"`\s])(?:sf|sfdx)(?:\.cmd|\.exe)?['"`\s]/i

/** What a guarded line names, for the reason, or null when it can go by. */
export function judgeShellLine(line: string, scope: ShellScope): string | null {
  const scan = scanLine(line)
  const texts = [flatten(line), ...scan.flat.map(flatten)]
  for (const rule of ALWAYS_RULES) if (texts.some(text => rule.pattern.test(text))) return rule.named
  if (!scope.activated) return null
  if (scan.commands.some(word => CLI_NAMES.has(basename(word)))) return 'the Salesforce CLI'
  if (/-enc(?:odedcommand)?\b/i.test(line)) return 'an encoded command'
  for (const rule of ACTIVATED_RULES) if (texts.some(text => rule.pattern.test(text))) return rule.named
  // The flat text of an interpreter's script is here too, but only a script is read this loosely.
  if (scan.scripts.some(script => QUOTED_CLI.test(script))) return 'the Salesforce CLI'
  return null
}

/** Best effort, and the docs say so: a filter can't catch every way out. */
export function isNetworkLooking(line: string): boolean {
  const scan = scanLine(line)
  for (const word of scan.commands) if (NETWORK_COMMANDS.has(basename(word))) return true
  for (const escape of ['\\', '`'] as const) {
    for (const words of tokenize(line, escape)) {
      if (basename(words[0] ?? '') === 'git' && words.slice(1).some(word => NETWORK_GIT.has(word.toLowerCase()))) return true
    }
  }
  // Quoted text is what a commit message is made of, so a URL or a call only counts in a script, or bare on the line.
  const bare = line.replace(/git\s+commit\b.*$/i, '')
  return NETWORK_TEXT.test(bare) || scan.scripts.some(script => NETWORK_TEXT.test(script))
}

export function guardReason(named: string): string {
  return `${GUARD_SOURCE} This line names ${named}, so a person has to approve it. Do not reshape the command to get past this. If the person says no, stop and tell them.`
}

export function networkReason(): string {
  return `${GUARD_SOURCE} This session read text from a Salesforce org, and this looks like it reaches the network. Text in an org can carry instructions, so a person has to approve this. Do not reshape the command to get past this. If the person says no, stop and tell them.`
}

export function fileDenyReason(named: string): string {
  return `${GUARD_SOURCE} File tools can't reach ${named} here. Do not reach it another way, and do not reshape the call. If the task needs it, stop and tell the person.`
}

function isUnder(path: string, segments: string): boolean {
  return `/${path}/`.includes(`/${segments}/`)
}

/** On a path resolved through its links, and on the path as spelled, since a file that isn't there yet has no resolved form. */
export function judgeFilePath(path: string, scope: FileScope): string | null {
  const flat = flatten(path)
  const parts = flat.split('/')
  const base = parts[parts.length - 1] ?? ''
  // These could turn a project on or stand in for the gate, so they apply whether or not it's on yet.
  if (isUnder(flat, 'plugins/store') && parts.some(part => part.startsWith('topia-salesforce'))) return "the Salesforce service's store"
  if (scope.isWrite && isUnder(flat, 'salesforce/service/bin')) return "the Salesforce service's code"
  if (!scope.activated) return null
  if (parts.includes('.sfdx')) return 'the Salesforce CLI login folder (.sfdx)'
  if (parts.includes('.sf')) return 'the Salesforce CLI config folder (.sf)'
  if (isUnder(flat, 'salesforce/service')) return "the Salesforce service's code"
  if (isUnder(flat, 'node_modules/@salesforce/cli')) return 'the Salesforce CLI package'
  if (isUnder(flat, 'plugins/store')) return 'the plugin store'
  if (isUnder(flat, '.claude') && (base === 'settings.json' || base === 'settings.local.json')) return 'Claude Code settings'
  if (scope.isWrite && isUnder(flat, '.topia/salesforce')) return "this project's Salesforce registry, journal, and plans"
  return null
}

/** A path as the guard compares it: lower case, forward slashes, no trailing slash, and `.` and `..` settled against a base when it is relative. */
function settled(path: string, base: string): string {
  const flat = flatten(path)
  const absolute = flat.startsWith('/') || /^[a-z]:/.test(flat) || flat.startsWith('~')
  const parts = (absolute ? flat : `${flatten(base)}/${flat}`).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  const joined = out.join('/')
  return flat.startsWith('/') || (!absolute && flatten(base).startsWith('/')) ? `/${joined}` : joined
}

function containsPath(root: string, inside: string): boolean {
  if (root === '/' || root === '') return true
  return inside === root || inside.startsWith(`${root}/`)
}

/**
 * A search reads everything under its root. So in a project that is on, the question is whether the root holds a
 * protected folder, and not only whether the root is one: a search from the folder above the store prints what
 * the store holds, with no file path ever named. In a project that is off, which is every project of someone
 * who has never used Salesforce, only a root inside the Salesforce store itself is judged. Home, `~/.claude` and
 * `/` search as they always have.
 */
export function judgeSearchRoot(root: string, scope: { activated: boolean; home: string | undefined; base: string }): string | null {
  const homeless = scope.home === undefined || scope.home === ''
  const at = settled(homeless ? root : root.replace(/^~(?=[\\/]|$)/, scope.home as string), scope.base)
  const home = homeless ? undefined : settled(scope.home as string, scope.base)
  // Inside the store: its file, its logs, its local folder. These are the same names judgeFilePath holds.
  if (home !== undefined && at.startsWith(`${home}/.claude/plugins/store/topia-salesforce`)) return "the Salesforce service's store"
  if (!scope.activated) return null
  // Above the store, or at the folder that holds it.
  if (home !== undefined && containsPath(at, `${home}/.claude/plugins/store`)) return "the Salesforce service's store"
  if (home !== undefined && containsPath(at, `${home}/.sfdx`)) return 'the Salesforce CLI login folder (.sfdx)'
  if (home !== undefined && containsPath(at, `${home}/.sf`)) return 'the Salesforce CLI config folder (.sf)'
  return null
}

/** The folder an absolute pattern starts in: everything up to the first wildcard. A pattern with no wildcard is a path of its own. */
export function patternRoot(pattern: string): string | null {
  const flat = pattern.replace(/\\/g, '/')
  if (!(flat.startsWith('/') || /^[A-Za-z]:\//.test(flat) || flat.startsWith('~'))) return null
  const wild = flat.search(/[*?[{]/)
  if (wild < 0) return flat
  const cut = flat.lastIndexOf('/', wild)
  return cut <= 0 ? '/' : flat.slice(0, cut)
}

export function filePathsOf(input: unknown): string[] {
  if (input === null || typeof input !== 'object') return []
  const given = input as Record<string, unknown>
  return [given.file_path, given.notebook_path, given.path].filter((item): item is string => typeof item === 'string' && item.length > 0)
}

export function filePatternsOf(input: unknown, tool: string): string[] {
  if (input === null || typeof input !== 'object') return []
  const given = input as Record<string, unknown>
  const pattern = tool === 'Glob' ? given.pattern : tool === 'Grep' ? given.glob : undefined
  return typeof pattern === 'string' && pattern.length > 0 ? [pattern] : []
}
