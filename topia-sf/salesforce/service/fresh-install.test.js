import assert from 'node:assert/strict'
import { execFileSync, execSync, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * A marketplace install of topia-sf is the plugin tree with no build and no npm
 * install. So this takes a clean copy of the plugin root the way an install
 * sees it, and starts the service from there with an empty PATH: no
 * node_modules, no dist, no sf, and no real org.
 */

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..', '..')
const gitRoot = join(pluginRoot, '..')

function inGit() {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: gitRoot, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

let tree = null
function copyPluginTree(out) {
  cpSync(pluginRoot, out, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(pluginRoot.length)
      if (!rel) return true
      const parts = rel.split(/[\\/]/).filter(Boolean)
      if (parts.includes('node_modules') || parts.includes('dist') || parts.includes('.git')) return false
      return true
    },
  })
}

function installed() {
  if (tree !== null) return tree
  const out = mkdtempSync(join(tmpdir(), 'sf-fresh-'))
  const gitDir = join(gitRoot, '.git')
  const mcp = join(out, 'salesforce', 'service', 'bin', 'mcp.js')
  try {
    // Prefer a committed topia-sf tree when the split is on HEAD.
    execSync('git archive --format=tar HEAD:topia-sf | tar -xf -', {
      cwd: out,
      env: { ...process.env, GIT_DIR: gitDir },
      stdio: 'pipe',
      shell: true,
    })
  } catch {
    // ignore: fall through to the working-tree copy
  }
  // A failing `git archive | tar` can still exit 0 with an empty extract on Windows.
  if (!existsSync(mcp)) copyPluginTree(out)
  assert.ok(existsSync(mcp), 'fresh-install tree is missing salesforce/service/bin/mcp.js')
  tree = out
  return out
}

function emptyHome(root) {
  const home = join(root, '.home')
  mkdirSync(home, { recursive: true })
  const env = { PATH: dirname(process.execPath), HOME: home, USERPROFILE: home, TEMP: tmpdir(), TMP: tmpdir(), CLAUDE_PROJECT_DIR: join(root, '.project') }
  if (process.env.SystemRoot !== undefined) env.SystemRoot = process.env.SystemRoot
  mkdirSync(env.CLAUDE_PROJECT_DIR, { recursive: true })
  return env
}

function askServer(root, env, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'salesforce', 'service', 'bin', 'mcp.js')], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const answers = new Map()
    let buffer = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`The server did not answer. ${stderr}`))
    }, 15_000)
    child.on('error', reject)
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const message = JSON.parse(buffer.slice(0, at))
        buffer = buffer.slice(at + 1)
        answers.set(message.id, message)
      }
      if (messages.every(item => item.id === undefined || answers.has(item.id))) {
        clearTimeout(timer)
        child.kill()
        resolve(answers)
      }
    })
    for (const message of messages) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  })
}

after(() => {
  if (tree !== null) rmSync(tree, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

test('the archive is what an install sees: no node_modules, no dist, and no fixtures in bin', { skip: !inGit() }, () => {
  const root = installed()
  assert.equal(existsSync(join(root, 'node_modules')), false)
  assert.equal(existsSync(join(root, 'salesforce', 'service', 'dist')), false)
  assert.ok(existsSync(join(root, 'salesforce', 'service', 'bin', 'mcp.js')))
  const names = readdirSync(join(root, 'salesforce', 'service', 'bin'))
  for (const name of names) assert.equal(/\.(case|test)\.js$|^test-support\.js$|fake|fixture/i.test(name), false, name)
})

test('everything bin/ imports is a Node built-in or a sibling in bin/', { skip: !inGit() }, () => {
  const bin = join(installed(), 'salesforce', 'service', 'bin')
  const names = new Set(readdirSync(bin))
  for (const name of names) {
    const source = readFileSync(join(bin, name), 'utf8')
    for (const match of source.matchAll(/(?:^|\s)(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/gm)) {
      const target = match[1]
      if (target.startsWith('node:')) continue
      assert.ok(target.startsWith('./'), `${name} imports ${target}`)
      assert.ok(names.has(target.slice(2)), `${name} imports ${target}, which is not in bin/`)
    }
  }
})

test('mcp.js starts from the archive and answers initialize and tools/list, with no npm install', { skip: !inGit() }, async () => {
  const root = installed()
  const answers = await askServer(root, emptyHome(root), [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fresh-install', version: '0' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
  ])
  assert.equal(answers.get(1)?.result?.serverInfo?.name, 'topia-salesforce')
  const tools = answers.get(2)?.result?.tools ?? []
  assert.ok(tools.some(tool => tool.name === 'org_inspect'))
  assert.ok(tools.some(tool => tool.name === 'dependency_report'))
  assert.equal(tools.some(tool => tool.name.startsWith('sf_')), false, 'nothing a person has to answer is served over stdio')
})

test('runner.js starts from the archive and answers, with no npm install and no sf', { skip: !inGit() }, () => {
  const root = installed()
  const env = emptyHome(root)
  const ran = spawnSync(process.execPath, [join(root, 'salesforce', 'service', 'bin', 'runner.js'), 'status'], { cwd: root, env, input: JSON.stringify({ projectRoot: env.CLAUDE_PROJECT_DIR }), encoding: 'utf8', timeout: 15_000 })
  assert.equal(ran.status, 0, ran.stderr)
  const reply = JSON.parse(ran.stdout)
  assert.equal(reply.lock.state, 'off')
  assert.equal(reply.registeredOrgs, 0)
})

test('the npm package ships bin/, and no source, test, or fixture of the service', { skip: !inGit() }, () => {
  const ran = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: pluginRoot, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: true })
  const files = JSON.parse(ran)[0].files.map(file => file.path.replaceAll('\\', '/'))
  const service = files.filter(path => path.startsWith('salesforce/service/'))
  assert.ok(service.includes('salesforce/service/bin/mcp.js'))
  assert.ok(service.includes('salesforce/service/bin/runner.js'))
  for (const path of service) assert.ok(path.startsWith('salesforce/service/bin/'), path)
  assert.equal(files.some(path => /\.case\.ts$|test-fixtures\/|test-support/.test(path)), false)
})
