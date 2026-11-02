import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { logDirectory } from './paths.js'
import { sweepProjectLogs, writeRunLog } from './log-retention.js'
import { tempPair } from './test-support.js'

const DAY = 24 * 60 * 60 * 1000

test('a 31-day-old log is removed and a 29-day-old log stays', () => {
  const pair = tempPair()
  try {
    const now = Date.parse('2026-06-01T00:00:00.000Z')
    for (const stream of ['plugin-tests', 'sf-test-runs'] as const) {
      const dir = logDirectory(pair.store, pair.root, stream)
      mkdirSync(dir, { recursive: true })
      const oldFile = join(dir, 'old.log')
      const youngFile = join(dir, 'young.log')
      writeFileSync(oldFile, 'old\n')
      writeFileSync(youngFile, 'young\n')
      utimesSync(oldFile, new Date(now - 31 * DAY), new Date(now - 31 * DAY))
      utimesSync(youngFile, new Date(now - 29 * DAY), new Date(now - 29 * DAY))
    }
    const swept = sweepProjectLogs(pair.store, pair.root, now)
    for (const stream of ['plugin-tests', 'sf-test-runs'] as const) {
      assert.deepEqual(swept[stream].removed, ['old.log'])
      assert.deepEqual(swept[stream].kept, ['young.log'])
      const dir = logDirectory(pair.store, pair.root, stream)
      assert.equal(existsSync(join(dir, 'old.log')), false)
      assert.equal(existsSync(join(dir, 'young.log')), true)
      assert.equal(dir.includes(pair.root.replace(/\\/g, '/').toLowerCase()) || dir.toLowerCase().includes('sf-proj-'), true)
      assert.equal(dir.includes('sf:user'), false)
    }
  } finally {
    pair.cleanup()
  }
})

test('run logs redact secrets', () => {
  const pair = tempPair()
  try {
    const dir = logDirectory(pair.store, pair.root, 'plugin-tests')
    const file = writeRunLog(
      dir,
      { command: 'tests.run', result: 'access_token=SECRET sessionId=00Dxx0000000001!ABCDEFGHIJ', durationMs: 12, correlationId: 'corr-1' },
      'run.log',
    )
    const text = readFileSync(file, 'utf8')
    assert.equal(text.includes('SECRET'), false)
    assert.equal(text.includes('ABCDEFGHIJ'), false)
    assert.match(text, /corr-1/)
    assert.match(text, /\[redacted\]/)
  } finally {
    pair.cleanup()
  }
})
