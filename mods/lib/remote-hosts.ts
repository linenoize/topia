import type { Host, SshTarget } from '../types'

// ssh options that take a value (`-i key`, or glued: `-p22`, `-oBatchMode=yes`).
const VALUE_OPTS = new Set('BbcDEeFIiJLlmOoPpQRSWw'.split(''))
export const FAILED = /Permission denied \(|Could not resolve hostname|Connection (timed out|refused|closed)|Host key verification failed|No route to host/i

function tokenize(segment: string): string[] {
  const tokens: string[] = []
  for (const match of segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return tokens
}

// Every `ssh … destination [command]` in a shell command line.
export function parseSsh(command: string): SshTarget[] {
  const targets: SshTarget[] = []
  for (const segment of command.split(/\r?\n|;|&&|\|\||(?<![|])\|(?![|])/)) {
    const tokens = tokenize(segment)
    const start = tokens.findIndex(token => /(^|[\\/])ssh(\.exe)?$/i.test(token))
    if (start < 0) continue

    let key: string | undefined
    let port: string | undefined
    let user: string | undefined
    let index = start + 1
    for (; index < tokens.length; index++) {
      const token = tokens[index] ?? ''
      if (!token.startsWith('-') || token === '-') break
      const flag = token[1] ?? ''
      if (!VALUE_OPTS.has(flag)) continue
      const value = token.length > 2 ? token.slice(2) : tokens[++index] ?? ''
      if (flag === 'i') key = value
      if (flag === 'p') port = value
      if (flag === 'l') user = value
      if (flag === 'o' && /^user=/i.test(value)) user = value.slice(5)
      if (flag === 'o' && /^port=/i.test(value)) port = value.slice(5)
    }

    const destination = (tokens[index] ?? '').replace(/^ssh:\/\//, '')
    if (!destination || /[$`{}<>]/.test(destination)) continue
    const at = destination.lastIndexOf('@')
    const hostPort = at >= 0 ? destination.slice(at + 1) : destination
    if (at >= 0) user = destination.slice(0, at)
    const [host = '', glued] = hostPort.split(':')
    if (!/^[A-Za-z0-9][A-Za-z0-9.\-]*$/.test(host)) continue
    targets.push({ host, user, key, port: glued ?? port, remote: tokens.slice(index + 1).join(' ') })
  }
  return targets
}

// Hosts stay with the project they were learned in: one store key per
// project root, so another repo never sees them.
export function hostsKey(root: string) {
  return `hosts:${root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`
}

export function hostId(target: { host: string; user?: string }) {
  return target.user ? `${target.user}@${target.host}` : target.host
}

export function composeText(known: Record<string, Host>): string | null {
  const list = Object.entries(known)
    .sort(([, a], [, b]) => b.lastOk.localeCompare(a.lastOk))
    .slice(0, 15)
  if (list.length === 0) return null

  return [
    '# Known SSH hosts',
    'Learned from ssh commands that worked in earlier sessions of this project. Connect with these directly; do not ask the user ' +
      'for connection details or run probe connections first. If one fails, say so and ask before guessing another.',
    ...list.map(([id, h]) => {
      const parts = [
        `ssh${h.key ? ` -i "${h.key}"` : ''}${h.port ? ` -p ${h.port}` : ''} ${id}`,
        h.sudoOk ? 'sudo worked non-interactively' : 'sudo untested',
        `last worked ${h.lastOk}`,
      ]
      return `- ${parts.join(' — ')}`
    }),
  ].join('\n')
}

// Folds ssh targets that just worked into the known hosts; returns the new
// map and the ids seen for the first time.
export function learnHosts(known: Record<string, Host>, targets: SshTarget[], today: string) {
  const next = { ...known }
  const learned: string[] = []
  for (const target of targets) {
    const id = hostId(target)
    const before = next[id]
    if (!before) learned.push(id)
    next[id] = {
      host: target.host,
      user: target.user,
      key: target.key ?? before?.key,
      port: target.port ?? before?.port,
      sudoOk: (before?.sudoOk ?? false) || /\bsudo\b/.test(target.remote),
      uses: (before?.uses ?? 0) + 1,
      firstSeen: before?.firstSeen ?? today,
      lastOk: today,
    }
  }
  return { known: next, learned }
}
