import { expect, test } from 'claude-code/testing'

import { DEFAULTS, RULES, composeText } from '../lib/standing-orders.ts'

test('a fresh install adds nothing to the system prompt', async () => {
  expect(composeText(DEFAULTS)).toBe(null)
})

test('only the orders turned on are added', async () => {
  const text = composeText({ fanout: true, ledger: true, scripts: false, commit: false }) ?? ''
  expect(text).toContain(RULES.fanout.text)
  expect(text).toContain(RULES.ledger.text)
  expect(text.includes(RULES.scripts.text)).toBe(false)
  expect(text.includes(RULES.commit.text)).toBe(false)
})
