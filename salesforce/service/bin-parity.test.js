import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const bin = join(here, 'bin')
const read = (dir, name) => readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n')

// Marketplace installs are git clones with no build step, so bin/ is what runs.
test('the committed bin/ matches a fresh build', () => {
  const out = mkdtempSync(join(tmpdir(), 'sf-bin-'))
  try {
    const tsc = require.resolve('typescript/bin/tsc')
    execFileSync(process.execPath, [tsc, '-p', join(here, 'tsconfig.bin.json'), '--outDir', out], { stdio: 'pipe' })
    const built = readdirSync(out).sort()
    assert.deepEqual(readdirSync(bin).sort(), built, 'Run npm run build:sf and commit salesforce/service/bin/.')
    for (const name of built) assert.equal(read(bin, name), read(out, name), `${name} is stale. Run npm run build:sf.`)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('bin/ ships no test code', () => {
  for (const name of readdirSync(bin)) assert.equal(/\.(case|test)\.js$|^test-support\.js$/.test(name), false, name)
})
