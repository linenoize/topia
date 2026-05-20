import assert from 'node:assert';
import { describe, test } from 'node:test';
import { detectPreset, mergePreset, stripTopiaHooks, summarizeTopiaHooks } from '../commands/hooks/merge.js';
import { buildPreset, isTopiaManaged } from '../commands/hooks/presets.js';

describe('isTopiaManaged', () => {
  // T3: must reject strings that merely contain "Topia" or "hook-dispatch"
  test('T3: rejects commands that contain "Topia hook-dispatch" as substring only', () => {
    const falsePositives = [
      'my-Topia hook-dispatch-notes.sh',
      '/usr/local/bin/topia hook-dispatch-runner',
      'echo "Topia hook-dispatch done"',
      'log-Topia hook-dispatch.log',
    ];
    for (const cmd of falsePositives) {
      assert.strictEqual(isTopiaManaged({ command: cmd }), false, `should NOT match: ${cmd}`);
    }
  });

  test('T3: matches the exact @protopia/skill-topia hook-dispatch invocation', () => {
    const truePositives = [
      'npx --yes @protopia/skill-topia hook-dispatch readiness',
      'npx @protopia/skill-topia hook-dispatch guardian',
      'npx --yes @protopia/skill-topia hook-dispatch completion-gate --gentle',
    ];
    for (const cmd of truePositives) {
      assert.strictEqual(isTopiaManaged({ command: cmd }), true, `should match: ${cmd}`);
    }
  });
});

describe('buildPreset', () => {
  test('produces valid gentle preset with expected events', () => {
    const preset = buildPreset('gentle');
    assert.ok(preset.hooks.PreToolUse);
    assert.ok(preset.hooks.PostToolUse);
    assert.ok(preset.hooks.Stop);
    const editGroup = preset.hooks.PreToolUse.find((g) => g.matcher === 'Edit|Write');
    assert.ok(editGroup.hooks[0].command.includes('readiness'));
    assert.ok(editGroup.hooks[0].command.includes('--gentle'));
  });

  test('strict preset omits --gentle flag', () => {
    const preset = buildPreset('strict');
    const editGroup = preset.hooks.PreToolUse.find((g) => g.matcher === 'Edit|Write');
    assert.ok(!editGroup.hooks[0].command.includes('--gentle'));
  });

  test('rejects unknown preset', () => {
    assert.throws(() => buildPreset('loose'), /Unknown preset/);
  });

  test('all commands carry Topia-managed signature', () => {
    for (const name of ['gentle', 'strict']) {
      const preset = buildPreset(name);
      for (const groups of Object.values(preset.hooks)) {
        for (const group of groups) {
          for (const entry of group.hooks) {
            assert.ok(isTopiaManaged(entry), `entry missing signature: ${JSON.stringify(entry)}`);
          }
        }
      }
    }
  });
});

describe('stripTopiaHooks', () => {
  test('removes Topia entries, preserves user entries', () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [
              { type: 'command', command: 'npx --yes @protopia/skill-topia hook-dispatch readiness --gentle' },
              { type: 'command', command: 'my-custom-hook.sh' },
            ],
          },
        ],
      },
    };
    const result = stripTopiaHooks(settings);
    const group = result.hooks.PreToolUse.find((g) => g.matcher === 'Edit|Write');
    assert.strictEqual(group.hooks.length, 1);
    assert.strictEqual(group.hooks[0].command, 'my-custom-hook.sh');
  });

  test('drops event if all entries were Topia-managed', () => {
    const settings = {
      hooks: {
        Stop: [
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: 'npx --yes @protopia/skill-topia hook-dispatch completion-gate' }],
          },
        ],
      },
    };
    const result = stripTopiaHooks(settings);
    assert.strictEqual(result.hooks, undefined);
  });

  test('handles missing hooks field', () => {
    assert.deepStrictEqual(stripTopiaHooks({ other: 'data' }), { other: 'data' });
  });

  test('returns {} for null input', () => {
    assert.deepStrictEqual(stripTopiaHooks(null), {});
  });

  test('preserves top-level non-hook fields', () => {
    const settings = {
      $schema: 'https://example.com/schema.json',
      env: { FOO: 'bar' },
      hooks: {
        Stop: [
          { matcher: '.*', hooks: [{ command: 'npx --yes @protopia/skill-topia hook-dispatch completion-gate' }] },
        ],
      },
    };
    const result = stripTopiaHooks(settings);
    assert.strictEqual(result.$schema, 'https://example.com/schema.json');
    assert.deepStrictEqual(result.env, { FOO: 'bar' });
  });
});

describe('mergePreset', () => {
  test('fresh install writes full preset', () => {
    const merged = mergePreset({}, buildPreset('gentle'));
    assert.ok(merged.hooks.PreToolUse);
    assert.ok(merged.hooks.Stop);
  });

  test('re-install replaces Topia entries, keeps user entries', () => {
    const initial = mergePreset({}, buildPreset('gentle'));
    // user adds their own hook to the same matcher
    initial.hooks.PreToolUse[0].hooks.push({ type: 'command', command: 'user-lint.sh' });

    const reinstalled = mergePreset(initial, buildPreset('strict'));
    const editGroup = reinstalled.hooks.PreToolUse.find((g) => g.matcher === 'Edit|Write');
    const commands = editGroup.hooks.map((h) => h.command);
    assert.ok(commands.includes('user-lint.sh'), 'user hook preserved');
    assert.ok(
      commands.some((c) => c.includes('readiness') && !c.includes('--gentle')),
      'strict preflight installed',
    );
    assert.ok(!commands.some((c) => c.includes('--gentle')), 'no gentle entries remain');
  });

  test('idempotent — same preset twice = same result', () => {
    const once = mergePreset({}, buildPreset('gentle'));
    const twice = mergePreset(once, buildPreset('gentle'));
    assert.deepStrictEqual(once, twice);
  });

  test('merges into existing user matcher without duplicate groups', () => {
    const userSettings = {
      hooks: {
        PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ command: 'user-guard.sh' }] }],
      },
    };
    const merged = mergePreset(userSettings, buildPreset('gentle'));
    const groups = merged.hooks.PreToolUse.filter((g) => g.matcher === 'Edit|Write');
    assert.strictEqual(groups.length, 1, 'no duplicate matcher group');
    assert.ok(groups[0].hooks.some((h) => h.command === 'user-guard.sh'));
    assert.ok(groups[0].hooks.some((h) => h.command.includes('readiness')));
  });
});

describe('summarizeTopiaHooks', () => {
  test('extracts skill names per event', () => {
    const merged = mergePreset({}, buildPreset('gentle'));
    const summary = summarizeTopiaHooks(merged);
    assert.strictEqual(summary.total, 5);
    assert.ok(summary.events.PreToolUse.includes('readiness'));
    assert.ok(summary.events.PreToolUse.includes('guardian'));
    assert.ok(summary.events.PostToolUse.includes('dependency-doctor'));
    assert.ok(summary.events.PostToolUse.includes('quarantine'));
    assert.ok(summary.events.Stop.includes('completion-gate'));
  });

  test('empty settings → zero total', () => {
    const summary = summarizeTopiaHooks({});
    assert.strictEqual(summary.total, 0);
  });
});

describe('detectPreset', () => {
  test('detects gentle', () => {
    assert.strictEqual(detectPreset(mergePreset({}, buildPreset('gentle'))), 'gentle');
  });
  test('detects strict', () => {
    assert.strictEqual(detectPreset(mergePreset({}, buildPreset('strict'))), 'strict');
  });
  test('detects mixed', () => {
    const mixed = mergePreset({}, buildPreset('gentle'));
    // manually inject a strict entry
    mixed.hooks.Stop[0].hooks.push({
      type: 'command',
      command: 'npx --yes @protopia/skill-topia hook-dispatch guardian',
    });
    assert.strictEqual(detectPreset(mixed), 'mixed');
  });
  test('returns none for empty settings', () => {
    assert.strictEqual(detectPreset({}), 'none');
  });
});
