import { expect, test } from 'claude-code/testing'

import { projectKey, projectName } from '../lib/model-preset.ts'

test('one key per project whatever the slashes or case', async () => {
  expect(projectKey('C:\\CodeBase\\Steepwright\\')).toBe(projectKey('c:/codebase/steepwright'))
  expect(projectName('C:\\CodeBase\\steepwright')).toBe('steepwright')
})
