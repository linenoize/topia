import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readZip, writeZip, ZipError } from './zip.js'

const ENTRIES = [
  { path: 'package.xml', bytes: Buffer.from('<Package/>') },
  { path: 'classes/Widget.cls', bytes: Buffer.from('public class Widget {}') },
  { path: 'classes/Empty.cls', bytes: Buffer.alloc(0) },
]

test('what goes in comes out', () => {
  const back = readZip(writeZip(ENTRIES))
  assert.deepEqual(back.map(item => item.path).sort(), ENTRIES.map(item => item.path).sort())
  for (const entry of ENTRIES) assert.deepEqual(back.find(item => item.path === entry.path)?.bytes, entry.bytes)
})

test('the same files make the same bytes, in any order', () => {
  assert.deepEqual(writeZip(ENTRIES), writeZip([...ENTRIES].reverse()))
})

function patched(bytes: Buffer, change: (copy: Buffer, central: number) => void): Buffer {
  const copy = Buffer.from(bytes)
  let end = copy.length - 22
  while (copy.readUInt32LE(end) !== 0x06054b50) end -= 1
  change(copy, copy.readUInt32LE(end + 16))
  return copy
}

test('a path that climbs out of the zip is refused', () => {
  for (const path of ['../evil.cls', 'a/../../evil.cls', '/etc/passwd', 'C:/evil.cls', 'a\\b.cls']) {
    assert.throws(() => readZip(writeZip([{ path, bytes: Buffer.from('x') }])), ZipError, path)
  }
})

test('an encrypted zip is refused, because what it holds can not be shown', () => {
  const zip = patched(writeZip([ENTRIES[0] as { path: string; bytes: Buffer }]), (copy, central) => copy.writeUInt16LE(1, central + 8))
  assert.throws(() => readZip(zip), /encrypted/)
})

test('the same path twice is refused', () => {
  const one = ENTRIES[0] as { path: string; bytes: Buffer }
  assert.throws(() => readZip(writeZip([one, one])), /twice/)
})

test('a damaged entry is refused, and never read as empty', () => {
  const zip = writeZip([ENTRIES[1] as { path: string; bytes: Buffer }])
  const copy = Buffer.from(zip)
  copy[50] = (copy[50] as number) ^ 0xff
  assert.throws(() => readZip(copy), ZipError)
  assert.throws(() => readZip(Buffer.from('not a zip at all, and long enough to scan')), /not a zip/)
  assert.throws(() => readZip(Buffer.alloc(3)), ZipError)
})

test('a compression this does not read is refused', () => {
  const zip = patched(writeZip([ENTRIES[0] as { path: string; bytes: Buffer }]), (copy, central) => copy.writeUInt16LE(12, central + 10))
  assert.throws(() => readZip(zip), /compression/)
})
