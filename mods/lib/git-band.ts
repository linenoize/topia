import type { GitInfo } from '../types'

export const WRITING_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'])

export const COMMIT = 'Commit the current changes with a descriptive message.'
export const COMMIT_PUSH = 'Commit the current changes with a descriptive message, then push to the remote.'
export const PUSH = 'Push the unpushed commits on this branch to the remote.'

export const NOT_A_REPO: GitInfo = { isRepo: false, branch: '', changed: 0, unpushed: 0, behind: 0, hasUpstream: false }

// `git status --porcelain=v1 --branch` → counts. The first line is the branch
// header: `## main...origin/main [ahead 2, behind 1]`, `## main` (no upstream),
// `## No commits yet on main`, or `## HEAD (no branch)`.
export function parseStatus(stdout: string): GitInfo {
  const lines = stdout.split(/\r?\n/).filter(line => line.length > 0)
  const header = lines[0]?.startsWith('## ') ? lines[0].slice(3) : ''
  const changed = lines.filter(line => !line.startsWith('## ')).length

  let branch = header
  let hasUpstream = false
  const noCommits = /^No commits yet on (.+)$/.exec(header)
  if (noCommits) {
    branch = noCommits[1] ?? header
  } else {
    const split = header.split('...')
    branch = (split[0] ?? header).split(' ')[0] ?? header
    hasUpstream = split.length > 1
  }

  const ahead = Number(/ahead (\d+)/.exec(header)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(header)?.[1] ?? 0)

  return { isRepo: true, branch, changed, unpushed: ahead, behind, hasUpstream }
}

export function bandParts(git: GitInfo): string[] {
  return [
    git.changed > 0 ? `${git.changed} changed` : '',
    git.unpushed > 0 ? `${git.unpushed} unpushed` : '',
    git.behind > 0 ? `${git.behind} behind` : '',
    git.hasUpstream ? '' : 'no upstream',
  ].filter(part => part.length > 0)
}
