import { expect, test } from 'claude-code/testing'

import { composeText, hostId, hostsKey, parseSsh } from '../lib/remote-hosts.ts'

// Fixtures use reserved names only: example.com / .test (RFC 2606) and
// 203.0.113.0/24 (RFC 5737). Never a real host, user or key path.

test('reads key, user and host from a quoted Windows key path', async () => {
  const [target] = parseSsh('ssh -i "C:\\Users\\dev\\.ssh\\id_ed25519" alice@box.test "uptime"')
  expect(target?.host).toBe('box.test')
  expect(target?.user).toBe('alice')
  expect(target?.key).toBe('C:\\Users\\dev\\.ssh\\id_ed25519')
})

test('skips -o options and reads glued ports', async () => {
  const [target] = parseSsh('ssh -o BatchMode=yes -o ConnectTimeout=5 -p2222 bob@203.0.113.7 "sudo -n true"')
  expect(target?.host).toBe('203.0.113.7')
  expect(target?.port).toBe('2222')
  expect(target && hostId(target)).toBe('bob@203.0.113.7')
})

test('finds ssh after a cd and ignores variables as hosts', async () => {
  expect(parseSsh('cd /c/x && ssh deploy@app.example.com ls').length).toBe(1)
  expect(parseSsh('ssh "$HOST" ls').length).toBe(0)
  expect(parseSsh('git push origin main').length).toBe(0)
})

test('hosts are stored per project, whatever the slashes or case', async () => {
  expect(hostsKey('C:\\Work\\ClientA')).toBe(hostsKey('c:/work/clienta/'))
  expect(hostsKey('C:\\Work\\ClientA') === hostsKey('C:\\Work\\ClientB')).toBe(false)
})

test('the prompt section lists hosts newest first, with their key', async () => {
  const text = composeText({
    'a@old': { host: 'old', user: 'a', sudoOk: false, uses: 1, firstSeen: '2026-09-01', lastOk: '2026-09-01' },
    'b@new': { host: 'new', user: 'b', key: 'k', sudoOk: true, uses: 3, firstSeen: '2026-09-01', lastOk: '2026-10-01' },
  }) ?? ''
  expect(text.indexOf('b@new') < text.indexOf('a@old')).toBe(true)
  expect(text).toContain('ssh -i "k" b@new')
  expect(composeText({})).toBe(null)
})
