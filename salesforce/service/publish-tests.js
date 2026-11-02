import { readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'dist')
const names = readdirSync(dir)
const fresh = new Set(names.filter(name => name.endsWith('.case.js')).map(name => name.replace(/\.case\.js$/, '.test.js')))
// A case that was deleted would otherwise keep running from its old build.
for (const name of names) {
  if (name.endsWith('.test.js') && !fresh.has(name)) rmSync(join(dir, name))
}
for (const name of names) {
  if (!name.endsWith('.case.js')) continue
  renameSync(join(dir, name), join(dir, name.replace(/\.case\.js$/, '.test.js')))
}
