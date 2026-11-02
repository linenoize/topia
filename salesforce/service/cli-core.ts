import { confirmTypedPath, disableProject, enableProject, lockState } from './activation.js'

/**
 * For hosts with no band. A person runs this in their own terminal and types
 * the path. It refuses when stdin is not a terminal. This is a speed bump, not
 * a boundary: anything running as the same user can do what it does.
 */
export type CliIo = {
  stdinIsTty: boolean
  readLine: (prompt: string) => Promise<string>
  write: (text: string) => void
  writeError: (text: string) => void
  cwd: string
  storeRoot: string
  now: () => number
  user: string
}

export const PROMISE =
  "Topia's Salesforce tools can change your org only after you approve the exact change in a dialog. That applies to Topia's tools, not to everything the assistant can do. The assistant can also run shell commands as you, and if your Salesforce CLI login can write, a shell command can write too. This approval slows that down, but it can't prevent it. To make it a hard limit, connect production with a read-only Salesforce user, and log in as a write-capable user only when you intend to make a change."

const USAGE = 'topia salesforce: enable | disable [--project <path>]. Run it yourself, in your own terminal.\n'

export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  const command = args[0] ?? 'help'
  const projectIndex = args.indexOf('--project')
  const projectRoot = projectIndex >= 0 ? (args[projectIndex + 1] ?? '') : io.cwd
  switch (command) {
    case 'enable':
      return confirmThen(io, projectRoot, 'on', () => {
        enableProject(io.storeRoot, projectRoot, io.user, new Date(io.now()).toISOString())
        io.write(`Salesforce is on for ${projectRoot}. Run this command again with disable to turn it off.\n\n${PROMISE}\n`)
      })
    case 'disable':
      return confirmThen(io, projectRoot, 'off', () => {
        disableProject(projectRoot, io.storeRoot, new Date(io.now()).toISOString())
        io.write(`Salesforce is off for ${projectRoot}. orgs.json, plans/, and docs/salesforce/ stay.\n`)
      })
    case 'help':
    case '--help':
      io.write(USAGE)
      return 0
    default:
      io.writeError(USAGE)
      return 1
  }
}

async function confirmThen(io: CliIo, projectRoot: string, target: 'on' | 'off', act: () => void): Promise<number> {
  if (!io.stdinIsTty) {
    io.writeError(`This needs a person at a terminal, so it refuses a piped stdin. Salesforce was not turned ${target}.\n`)
    return 1
  }
  const lock = lockState(io.storeRoot, projectRoot)
  if (lock.state === 'unreadable') {
    io.writeError(`${lock.message} Nothing changed.\n`)
    return 1
  }
  if (target === 'on') io.write(`${PROMISE}\n\n`)
  const typed = await io.readLine(`Type this project's path to turn Salesforce ${target} for it only:\n${projectRoot}\n> `)
  const confirmed = confirmTypedPath(projectRoot, typed.trim())
  if (!confirmed.ok) {
    io.writeError(`${confirmed.reason}\n`)
    return 1
  }
  act()
  return 0
}
