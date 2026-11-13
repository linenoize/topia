import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { applyEntries, matchCatalog, parkServer, readCatalog } from '../../skills/onboard/scripts/mcp-catalog.js';

function tempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

const CATALOG = {
  version: 1,
  servers: {
    rea: {
      about: 'Reverse engineering.',
      signals: ['*.apk', 'firmware/', 'decompile'],
      config: { type: 'stdio', command: 'npx', args: ['-y', 'rea-agents', 'mcp'] },
    },
    pencil: { about: 'Design files.', signals: ['*.pen'], config: { type: 'stdio', command: 'pencil-mcp' } },
  },
  plugins: { 'pm@market': { about: 'Product management.', signals: ['roadmap'] } },
};

function writeCatalog(dir, catalog = CATALOG) {
  const file = path.join(dir, 'mcp-catalog.json');
  writeFileSync(file, JSON.stringify(catalog));
  return file;
}

describe('mcp-catalog: match', () => {
  test('a missing catalog reads as empty, not an error', () => {
    const dir = tempDir('topia-cat-');
    try {
      assert.deepStrictEqual(readCatalog(path.join(dir, 'nope.json')), { version: 1, servers: {}, plugins: {} });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('file, folder and keyword signals each match, and say why', () => {
    const root = tempDir('topia-proj-');
    try {
      mkdirSync(path.join(root, 'app'));
      writeFileSync(path.join(root, 'app', 'client.apk'), '');
      writeFileSync(path.join(root, 'README.md'), '# Plans\nOur roadmap for Q3.\n');
      const matches = matchCatalog(CATALOG, root);
      const byName = Object.fromEntries(matches.map((m) => [m.name, m]));
      assert.deepStrictEqual(Object.keys(byName).sort(), ['pm@market', 'rea']);
      assert.strictEqual(byName.rea.kind, 'server');
      assert.ok(byName.rea.why.includes('*.apk'));
      assert.strictEqual(byName['pm@market'].kind, 'plugin');
      assert.ok(byName['pm@market'].why.includes('roadmap'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a keyword matches whole words only', () => {
    const root = tempDir('topia-proj-');
    try {
      writeFileSync(path.join(root, 'README.md'), 'We inspect specific roadmaps.\n');
      const catalog = { servers: {}, plugins: { p: { signals: ['spec', 'roadmap'] } } };
      assert.deepStrictEqual(matchCatalog(catalog, root), []);
      writeFileSync(path.join(root, 'README.md'), 'See the spec.\n');
      assert.deepStrictEqual(matchCatalog(catalog, root)[0].why, ['spec']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a folder signal matches a directory, and node_modules is never searched', () => {
    const root = tempDir('topia-proj-');
    try {
      mkdirSync(path.join(root, 'firmware'));
      mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
      writeFileSync(path.join(root, 'node_modules', 'x', 'a.pen'), '');
      const names = matchCatalog(CATALOG, root).map((m) => m.name);
      assert.deepStrictEqual(names, ['rea']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('mcp-catalog: apply and park', () => {
  // Records the argument arrays the claude CLI would get. No shell, so no quoting.
  function fakeRunner() {
    const calls = [];
    return { calls, run: (args) => calls.push(args) };
  }

  test('a server is added at local scope with its exact JSON, a plugin is enabled at local scope', () => {
    const { calls, run } = fakeRunner();
    const applied = applyEntries(CATALOG, ['rea', 'pm@market'], { run });
    assert.deepStrictEqual(applied, ['rea', 'pm@market']);
    assert.deepStrictEqual(calls[0].slice(0, 3), ['mcp', 'add-json', 'rea']);
    assert.deepStrictEqual(JSON.parse(calls[0][3]), CATALOG.servers.rea.config);
    assert.deepStrictEqual(calls[0].slice(4), ['-s', 'local']);
    assert.deepStrictEqual(calls[1], ['plugin', 'enable', 'pm@market', '--scope', 'local']);
  });

  test('an unknown name is refused before anything runs', () => {
    const { calls, run } = fakeRunner();
    assert.throws(() => applyEntries(CATALOG, ['rea', 'nope'], { run }), /nope/);
    assert.strictEqual(calls.length, 0);
  });

  test('a Windows path in a config survives the round trip', () => {
    const { calls, run } = fakeRunner();
    const catalog = {
      servers: { w: { config: { command: 'C:\\Tools\\mcp server.exe', args: ['--a'] } } },
      plugins: {},
    };
    applyEntries(catalog, ['w'], { run });
    assert.strictEqual(JSON.parse(calls[0][3]).command, 'C:\\Tools\\mcp server.exe');
  });

  test('park copies a user-scope server into the catalog, then removes it from user scope', () => {
    const dir = tempDir('topia-park-');
    try {
      const userConfig = path.join(dir, 'claude.json');
      writeFileSync(userConfig, JSON.stringify({ mcpServers: { gx: { command: 'gx', args: ['serve'] } } }));
      const catalogFile = writeCatalog(dir);
      const { calls, run } = fakeRunner();
      parkServer('gx', { catalogFile, userConfig, run, about: 'Graph tool.', signals: ['*.graph'] });
      const saved = JSON.parse(readFileSync(catalogFile, 'utf8'));
      assert.deepStrictEqual(saved.servers.gx.config, { command: 'gx', args: ['serve'] });
      assert.deepStrictEqual(saved.servers.gx.signals, ['*.graph']);
      assert.deepStrictEqual(calls, [['mcp', 'remove', 'gx', '-s', 'user']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('park refuses a server that is not at user scope, and changes nothing', () => {
    const dir = tempDir('topia-park-');
    try {
      const userConfig = path.join(dir, 'claude.json');
      writeFileSync(userConfig, JSON.stringify({ mcpServers: {} }));
      const catalogFile = writeCatalog(dir);
      const before = readFileSync(catalogFile, 'utf8');
      const { calls, run } = fakeRunner();
      assert.throws(() => parkServer('gx', { catalogFile, userConfig, run }), /user scope/);
      assert.strictEqual(readFileSync(catalogFile, 'utf8'), before);
      assert.strictEqual(calls.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
