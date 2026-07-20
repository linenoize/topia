import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const REPO = join(import.meta.dirname, '..', '..');

const { formatSessionReport, formatTierSummary } = require('../../hooks/lib/session-report.cjs');

describe('session-report', () => {
  test('formatTierSummary orders opus sonnet haiku', () => {
    assert.equal(formatTierSummary({ haiku: 2, opus: 1, sonnet: 3 }), 'opus:1 sonnet:3 haiku:2');
  });

  test('formatSessionReport includes summary and details', () => {
    const text = formatSessionReport(
      {
        skillCounts: { build: 2, recon: 1 },
        skillChain: ['build', 'recon', 'build'],
        skillDurations: { build: 5000 },
        toolCounts: { Read: 10, Edit: 3 },
        toolCalls: 13,
        durationMin: 4,
        primarySkill: 'build',
        skillInvocations: 3,
        tokens: { confidence: 'estimate', total_estimated: 1200, context_peak: 45000 },
      },
      REPO,
    );

    assert.ok(text);
    assert.match(text, /Topia · 3 skills · models/);
    assert.match(text, /<details>/);
    assert.match(text, /build.*×2/);
    assert.match(text, /Read: 10/);
    assert.match(text, /build → recon → build/);
  });

  test('formatSessionReport returns null when no activity', () => {
    const text = formatSessionReport(
      {
        skillCounts: {},
        skillChain: [],
        skillDurations: {},
        toolCounts: {},
        toolCalls: 0,
        durationMin: 0,
        primarySkill: 'none',
        skillInvocations: 0,
      },
      REPO,
    );
    assert.equal(text, null);
  });
});

describe('skill-catalog.cjs bare slash', () => {
  const { matchBareTopiaSlash, formatBareSlashRedirect } = require('../../hooks/lib/skill-catalog.cjs');

  test('matchBareTopiaSlash for /plan', () => {
    assert.equal(matchBareTopiaSlash('/plan'), 'plan');
    assert.equal(matchBareTopiaSlash('/topia-plan'), null);
  });

  test('formatBareSlashRedirect for build', () => {
    const msg = formatBareSlashRedirect('build');
    assert.match(msg, /topia-build/);
  });
});
