import { expect, test } from 'claude-code/testing'

import { joinStatus } from '../lib/status.ts'

test('the status line joins the slots in a fixed order and clears when empty', async () => {
  expect(joinStatus({ usage: 'ctx 40%', orders: 'orders: fanout' })).toBe('orders: fanout · ctx 40%')
  expect(joinStatus({ usage: 'ctx 40%' })).toBe('ctx 40%')
  expect(joinStatus({})).toBe(undefined)
})
