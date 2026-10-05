import { expect, test } from 'claude-code/testing'

import { parseStatus } from '../lib/git-band.ts'

test('counts changes and ahead/behind against the upstream', async () => {
  const info = parseStatus('## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n')
  expect(info).toEqual({ isRepo: true, branch: 'main', changed: 2, unpushed: 2, behind: 1, hasUpstream: true })
})

test('a clean branch in sync reads as nothing to do', async () => {
  const info = parseStatus('## main...origin/main\n')
  expect(info.changed).toBe(0)
  expect(info.unpushed).toBe(0)
  expect(info.hasUpstream).toBe(true)
})

test('a branch with no upstream says so', async () => {
  const info = parseStatus('## phase5.1\r\n M server/app.js\r\n')
  expect(info.branch).toBe('phase5.1')
  expect(info.hasUpstream).toBe(false)
  expect(info.changed).toBe(1)
})

test('a new repo with no commits names its branch', async () => {
  const info = parseStatus('## No commits yet on main\n?? README.md\n')
  expect(info.branch).toBe('main')
  expect(info.changed).toBe(1)
})
