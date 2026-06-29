/**
 * Shared identifier mappings for topia ↔ skill-topia fork sync.
 * toLinenoize: protopia/skill-topia → linenoize/topia (rare reverse port)
 * toProtopia:   linenoize/topia → protopia/skill-topia (normal release direction)
 */

/** @typedef {{ file: string, pairs: [string, string][] }} ScopedRule */

/** @type {[string, string][]} */
export const TO_LINENOIZE_REPLACEMENTS = [
  ['@protopia/skill-topia', '@linenoize/topia'],
  ['@protopia\\/skill-topia', '@linenoize\\/topia'],
  ['https://github.com/protopia/skill-topia', 'https://github.com/linenoize/topia'],
  ['github.com/protopia/skill-topia', 'github.com/linenoize/topia'],
  ['https://protopia.github.io/skill-topia', 'https://linenoize.github.io/topia'],
  ['protopia.github.io/skill-topia', 'linenoize.github.io/topia'],
  ['protopia/skill-topia', 'linenoize/topia'],
  ['Topia@protopia', 'topia@linenoize'],
  ['Topia:', 'topia:'],
  ['cache/protopia/Topia', 'cache/linenoize/topia'],
  ['plugins/cache/protopia/skill-topia', 'plugins/cache/linenoize/topia'],
  ['Protopia marketplace', 'linenoize marketplace'],
  ['Protopia Claude Code marketplace', 'linenoize Claude Code marketplace'],
  ['author: skill-topia', 'author: topia'],
  ['"author": "skill-topia"', '"author": "topia"'],
];

/** @type {ScopedRule[]} */
export const TO_LINENOIZE_SCOPED = [
  {
    file: '.claude-plugin/marketplace.json',
    pairs: [
      ['"name": "protopia"', '"name": "linenoize"'],
      ['"name": "Protopia"', '"name": "linenoize"'],
    ],
  },
  {
    file: 'compiler/commands/install.js',
    pairs: [
      ["const MARKETPLACE_ID = 'protopia';", "const MARKETPLACE_ID = 'linenoize';"],
      ['<path-to-skill-topia>', '<path-to-topia>'],
    ],
  },
  {
    file: 'docs/templates/team-claude-settings.json',
    pairs: [['"protopia": {', '"linenoize": {']],
  },
  {
    file: '.claude-plugin/plugin.json',
    pairs: [['"name": "Topia"', '"name": "topia",\n  "displayName": "Topia"']],
  },
  {
    file: '.claude-plugin/marketplace.json',
    pairs: [
      ['"name": "Topia"', '"name": "topia"'],
      ['"source": "./",', '"source": { "source": "url", "url": "https://github.com/linenoize/topia.git" },'],
      [
        '"source": { "source": "github", "repo": "protopia/skill-topia" },',
        '"source": { "source": "url", "url": "https://github.com/linenoize/topia.git" },',
      ],
      [
        '"source": { "source": "github", "repo": "linenoize/topia" },',
        '"source": { "source": "url", "url": "https://github.com/linenoize/topia.git" },',
      ],
    ],
  },
];

/** @type {[string, string][]} */
export const TO_PROTOPIA_REPLACEMENTS = [
  ['@linenoize/topia', '@protopia/skill-topia'],
  ['@linenoize\\/topia', '@protopia\\/skill-topia'],
  ['https://github.com/linenoize/topia', 'https://github.com/protopia/skill-topia'],
  ['github.com/linenoize/topia', 'github.com/protopia/skill-topia'],
  ['https://linenoize.github.io/topia', 'https://protopia.github.io/skill-topia'],
  ['linenoize.github.io/topia', 'protopia.github.io/skill-topia'],
  ['linenoize/topia', 'protopia/skill-topia'],
  ['topia@linenoize', 'topia@protopia'],
  ['cache/linenoize/topia', 'cache/protopia/topia'],
  ['cache/linenoize/Topia', 'cache/protopia/Topia'],
  ['plugins/cache/linenoize/topia', 'plugins/cache/protopia/skill-topia'],
  ['linenoize marketplace', 'Protopia marketplace'],
  ['linenoize Claude Code marketplace', 'Protopia Claude Code marketplace'],
  ['author: topia', 'author: skill-topia'],
  ['"author": "topia"', '"author": "skill-topia"'],
];

const PROTOPIA_CACHE_CANDIDATES = `  const cacheCandidates = [
    path.join(home, '.claude', 'plugins', 'cache', 'protopia', 'topia'),
    path.join(home, '.claude', 'plugins', 'cache', 'protopia', 'Topia'),
    path.join(home, '.claude', 'plugins', 'cache', 'protopia', 'skill-topia'),
    path.join(home, '.claude', 'plugins', 'cache', 'topia'),
    path.join(home, '.claude', 'plugins', 'cache', 'Topia'),
    path.join(home, '.claude', 'plugins', 'cache', 'skill-topia'),
  ];`;

const LINENOIZE_CACHE_CANDIDATES = `  const cacheCandidates = [
    path.join(home, '.claude', 'plugins', 'cache', 'linenoize', 'topia'),
    path.join(home, '.claude', 'plugins', 'cache', 'linenoize', 'Topia'),
    path.join(home, '.claude', 'plugins', 'cache', 'topia'),
    path.join(home, '.claude', 'plugins', 'cache', 'Topia'),
  ];`;

/** @type {ScopedRule[]} */
export const TO_PROTOPIA_SCOPED = [
  {
    file: '.claude-plugin/marketplace.json',
    pairs: [
      ['"name": "linenoize",\n  "description"', '"name": "protopia",\n  "description"'],
      ['"owner": {\n    "name": "linenoize"\n  }', '"owner": {\n    "name": "Protopia"\n  }'],
      ['"owner": {\n    "name": "protopia"\n  }', '"owner": {\n    "name": "Protopia"\n  }'],
      ['"author": {\n        "name": "topia"\n      }', '"author": {\n        "name": "skill-topia"\n      }'],
    ],
  },
  {
    file: '.claude-plugin/plugin.json',
    pairs: [['"author": {\n    "name": "topia"\n  }', '"author": {\n    "name": "skill-topia"\n  }']],
  },
  {
    file: 'compiler/commands/install.js',
    pairs: [
      ["const MARKETPLACE_ID = 'linenoize';", "const MARKETPLACE_ID = 'protopia';"],
      ['<path-to-topia>', '<path-to-skill-topia>'],
    ],
  },
  {
    file: 'docs/templates/team-claude-settings.json',
    pairs: [['"linenoize": {', '"protopia": {']],
  },
  {
    file: 'compiler/commands/hooks/resolve-topia-root.js',
    pairs: [[LINENOIZE_CACHE_CANDIDATES, PROTOPIA_CACHE_CANDIDATES]],
  },
  {
    file: '.claude-plugin/marketplace.json',
    pairs: [
      [
        '"source": { "source": "url", "url": "https://github.com/linenoize/topia.git" },',
        '"source": { "source": "github", "repo": "protopia/skill-topia" },',
      ],
      [
        '"source": { "source": "url", "url": "https://github.com/protopia/skill-topia.git" },',
        '"source": { "source": "github", "repo": "protopia/skill-topia" },',
      ],
      [
        '"source": { "source": "github", "repo": "linenoize/topia" },',
        '"source": { "source": "github", "repo": "protopia/skill-topia" },',
      ],
    ],
  },
  {
    file: 'scripts/__tests__/marketplace.test.js',
    pairs: [
      ["assert.equal(marketplace.name, 'linenoize');", "assert.equal(marketplace.name, 'protopia');"],
      [
        "assert.equal(typeof entry.source, 'object', 'source should be a url object');\n    assert.equal(entry.source.source, 'url');\n    assert.equal(entry.source.url, 'https://github.com/linenoize/topia.git');",
        "assert.equal(typeof entry.source, 'object', 'source should be a github object');\n    assert.equal(entry.source.source, 'github');\n    assert.equal(entry.source.repo, 'protopia/skill-topia');",
      ],
    ],
  },
];

export const toLinenoize = {
  replacements: TO_LINENOIZE_REPLACEMENTS,
  scoped: TO_LINENOIZE_SCOPED,
};

export const toProtopia = {
  replacements: TO_PROTOPIA_REPLACEMENTS,
  scoped: TO_PROTOPIA_SCOPED,
};
