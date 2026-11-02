#!/usr/bin/env node
// Writes sf-flags.snapshot.json from a saved `sf commands --json`, keeping only
// the commands the adapter uses. Add a command to USED when the adapter gains one,
// then run:
//   node salesforce/service/test-fixtures/generate-flag-snapshot.mjs <commands.json> <cli version>
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const USED = [
  'version',
  'org:display',
  'data:query',
  'sobject:describe',
  'api:request:rest',
  'project:retrieve:start',
  'data:update:bulk',
  'data:delete:bulk',
  'data:bulk:results',
  'project:deploy:validate',
  'project:deploy:start',
  'project:deploy:quick',
  'project:deploy:report',
  'project:deploy:cancel',
  'apex:run:test',
  'apex:get:test',
]

const [source, version] = process.argv.slice(2)
if (!source || !version) {
  process.stderr.write('usage: generate-flag-snapshot.mjs <commands.json> <cli version>\n')
  process.exit(2)
}

const all = JSON.parse(readFileSync(source, 'utf8'))
const commands = {}
for (const id of USED) {
  const entry = all.find(item => item.id === id)
  if (!entry) throw new Error(`${id} is not in ${source}`)
  const flags = {}
  for (const [name, flag] of Object.entries(entry.flags).sort(([a], [b]) => a.localeCompare(b))) {
    flags[name] = {
      type: flag.type,
      ...(flag.char ? { char: flag.char } : {}),
      ...(flag.multiple ? { multiple: true } : {}),
      ...(flag.options ? { options: flag.options } : {}),
    }
  }
  commands[id.replaceAll(':', ' ')] = { flags, args: Object.keys(entry.args ?? {}) }
}

const target = join(dirname(fileURLToPath(import.meta.url)), 'sf-flags.snapshot.json')
writeFileSync(target, `${JSON.stringify({ cliVersion: version, source: 'sf commands --json', commands }, null, 2)}\n`)
process.stdout.write(`Wrote ${Object.keys(commands).length} commands for ${version}.\n`)
