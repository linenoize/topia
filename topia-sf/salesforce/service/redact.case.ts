import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { logDirectory } from './paths.js'
import { writeRunLog } from './log-retention.js'
import { redactSecrets, redactValue, redactXml } from './redact.js'
import { tempPair } from './test-support.js'

// All synthetic. These are the samples that passed through unchanged before.
const JSON_SAMPLES = [
  ['{"access_token":"SYNTHETICabc123"}', 'SYNTHETICabc123'],
  ['{"password":"SYNTHETICpw"}', 'SYNTHETICpw'],
  ['{"accessToken":"SYNTHETICcamel"}', 'SYNTHETICcamel'],
  ['{"refresh-token":"SYNTHETICdash"}', 'SYNTHETICdash'],
  ['{"CLIENT_SECRET":"SYNTHETICupper"}', 'SYNTHETICupper'],
  ['{"sfdxAuthUrl":"SYNTHETICurl"}', 'SYNTHETICurl'],
  ['{"privateKey":"SYNTHETICkey"}', 'SYNTHETICkey'],
  ['{"sessionId":"SYNTHETICsession"}', 'SYNTHETICsession'],
  ['{"sid":"SYNTHETICsid"}', 'SYNTHETICsid'],
  ['{"consumerSecret":"SYNTHETICconsumer"}', 'SYNTHETICconsumer'],
  ['{"nested":{"deep":[{"access_token":"SYNTHETICdeep"}]}}', 'SYNTHETICdeep'],
  ['[{"Password__c":"SYNTHETICfield"}]', 'SYNTHETICfield'],
] as const

test('secret keys in JSON are redacted, whatever the case or separator', () => {
  for (const [input, secret] of JSON_SAMPLES) {
    const output = redactSecrets(input)
    assert.equal(output.includes(secret), false, input)
    assert.match(output, /\[redacted\]/, input)
    JSON.parse(output)
  }
})

test('sid matches only as the whole key', () => {
  const output = JSON.parse(redactSecrets('{"sid":"a","Side__c":"b","inside":"c","resident":"d"}')) as Record<string, string>
  assert.deepEqual(output, { sid: '[redacted]', Side__c: 'b', inside: 'c', resident: 'd' })
})

test('value patterns are redacted anywhere in text', () => {
  const samples = [
    'force://PlatformCLI::5AepSYNTHETICrefresh@acme.my.example.com',
    'token 00D000000000001!AQEAQSYNTHETICsession end',
    'refresh 5AepSYNTHETICrefreshToken123 end',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJlU1lOVEhFVElD',
    'Authorization: Bearer SYNTHETICbearer',
  ]
  for (const sample of samples) {
    const output = redactSecrets(sample)
    assert.equal(/SYNTHETIC|5Aep|00D000000000001!|eyJ/.test(output), false, `${sample} -> ${output}`)
  }
})

test('a line of key=value text keeps its key and loses its value', () => {
  const output = redactSecrets('access_token=SECRET sessionId=00Dxx0000000001!ABCDEFGHIJ refresh_token: "ALSO" keep=this')
  assert.equal(/SECRET|ABCDEFGHIJ|ALSO/.test(output), false)
  assert.match(output, /keep=this/)
  assert.match(output, /access_token=\[redacted\]/)
})

test('secret elements in XML lose their text, and the rest stays', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ConnectedApp xmlns="http://soap.sforce.com/2006/04/metadata">
  <label>Acme Widget App</label>
  <oauthConfig>
    <callbackUrl>https://acme.example.com/callback</callbackUrl>
    <consumerKey>SYNTHETICpublicKey</consumerKey>
    <consumerSecret>SYNTHETICconsumerSecret</consumerSecret>
  </oauthConfig>
  <password>SYNTHETICpw</password>
  <privateKey><![CDATA[SYNTHETICcdata]]></privateKey>
  <NS:oauthToken xmlns:NS="urn:x">SYNTHETICprefixed</NS:oauthToken>
</ConnectedApp>`
  const { text, redactions } = redactXml(xml)
  for (const secret of ['SYNTHETICconsumerSecret', 'SYNTHETICpw', 'SYNTHETICcdata', 'SYNTHETICprefixed']) assert.equal(text.includes(secret), false, secret)
  assert.match(text, /<consumerSecret>\[redacted\]<\/consumerSecret>/)
  assert.match(text, /Acme Widget App/)
  assert.match(text, /https:\/\/acme\.example\.com\/callback/)
  assert.equal(redactions, 4)
})

test('a secret attribute and a value pattern inside XML text are redacted too', () => {
  const { text } = redactXml('<a password="SYNTHETICattr"><b>00D000000000001!AQEASYNTHETIC</b></a>')
  assert.equal(text.includes('SYNTHETICattr'), false)
  assert.equal(text.includes('AQEASYNTHETIC'), false)
})

test('redactSecrets treats XML as XML', () => {
  assert.equal(redactSecrets('<password>SYNTHETICpw</password>').includes('SYNTHETICpw'), false)
  assert.equal(redactSecrets('<consumerSecret>SYNTHETICcs</consumerSecret>').includes('SYNTHETICcs'), false)
})

test('redactValue walks objects, including a JSON or XML string held in a field', () => {
  const output = redactValue({
    accessToken: 'SYNTHETICa',
    refreshToken: 'SYNTHETICb',
    clientSecret: 'SYNTHETICc',
    sfdxAuthUrl: 'SYNTHETICd',
    privateKey: 'SYNTHETICe',
    safe: 'keep me',
    list: ['force://x::5AepSYNTHETICf@y', 1, true, null],
    jsonText: '{"password":"SYNTHETICg"}',
    xmlText: '<password>SYNTHETICh</password>',
  })
  const text = JSON.stringify(output)
  assert.equal(text.includes('SYNTHETIC'), false, text)
  assert.match(text, /keep me/)
  assert.deepEqual((output as { list: unknown[] }).list.slice(1), [1, true, null])
})

test('text that merely looks structured is left readable', () => {
  assert.equal(redactSecrets('{not json} and a < b'), '{not json} and a < b')
  assert.equal(redactSecrets('The password field is required.'), 'The password field is required.')
  assert.equal(redactValue(12), 12)
  assert.equal(redactValue(null), null)
})

test('a run log of a JSON result keeps no secret', () => {
  const pair = tempPair()
  try {
    const dir = logDirectory(pair.store, pair.root, 'plugin-tests')
    const file = writeRunLog(dir, { command: 'x', result: JSON.stringify({ access_token: 'SYNTHETICabc123', password: 'SYNTHETICpw' }), durationMs: 1, correlationId: 'c' }, 'run.log')
    assert.equal(readFileSync(file, 'utf8').includes('SYNTHETIC'), false)
  } finally {
    pair.cleanup()
  }
})
