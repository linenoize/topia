import assert from 'node:assert/strict'
import { test } from 'node:test'

import { acceptValidation } from './deploy-zip.js'
import { isFailure } from './adapter.js'
import { parseDeployRun } from './sf-parse.js'

// Review M10: a job report in an unexpected shape is unknown, and never a pass.

const ID = '0Af000000000001AAA'
const BODY = { id: ID, status: 'Succeeded', done: true, success: true, checkOnly: true, createdBy: '005000000000001AAA', startDate: '2026-06-01T00:00:00.000Z', runTestsEnabled: true, numberTestsCompleted: 2, numberTestsTotal: 2, numberTestErrors: 0, numberComponentErrors: 0, ignoreWarnings: false, rollbackOnError: true, details: { componentSuccesses: [], componentFailures: [], runTestResult: {} } }

function parse(over: Record<string, unknown>, tests: unknown[] = []) {
  const details = { ...BODY.details, runTestResult: { failures: tests } }
  return parseDeployRun({ outcome: 'exited', code: 0, stdout: JSON.stringify({ status: 0, result: { ...BODY, details, ...over } }), stderr: '' })
}

test('M10: a finished job whose counts are missing, or text, is unknown', () => {
  for (const over of [{ numberTestErrors: undefined }, { numberTestErrors: '2' }, { numberComponentErrors: '1' }, { numberComponentErrors: undefined }, { numberTestsCompleted: null }, { numberTestErrors: Number.NaN }]) {
    const got = parse(over, [{ name: 'A' }, { name: 'B' }])
    assert.equal(isFailure(got), true, JSON.stringify(over))
    assert.equal((got as { failure: string }).failure, 'unknown')
  }
})

test('M10: a job that is still running need not have counts', () => {
  const got = parse({ done: false, status: 'InProgress', numberTestErrors: undefined, numberComponentErrors: undefined, numberTestsCompleted: undefined })
  assert.equal(isFailure(got), false)
})

test('M10: a failure listed in the test results is a problem even when the count says none', () => {
  const got = parse({}, [{ name: 'A' }, { name: 'B' }])
  assert.equal(isFailure(got), false)
  const problems = acceptValidation(got as never, { userId: '005000000000001AAA', members: [], destructive: [], ignoreWarnings: false, now: Date.parse('2026-06-02T00:00:00.000Z') })
  assert.ok(problems.some(item => /2 tests failed/.test(item)), JSON.stringify(problems))
})
