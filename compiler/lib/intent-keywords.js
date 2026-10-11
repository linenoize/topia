/**
 * intent-keywords.js — the words in a prompt that point at each Topia skill
 *
 * One source for the compiled skill-index (`intents`, read by the intent-router
 * hook) and for the prompt-routing mod (mods/lib/skill-routes.generated.ts).
 * Phrases come from each skill's description and skill-router's Request
 * Classifier and Power User tables. The mod matches them on word boundaries
 * (a trailing s/es/ed/d/ing allowed), so keep them whole words or phrases.
 */

/** @type {Record<string, string[]>} */
export const INTENT_KEYWORDS = {
  // L1 orchestrators
  build: ['implement', 'build', 'create', 'add', 'feature', 'fix', 'write', 'make', 'develop'],
  team: ['parallel', 'split this up', 'do all of these', 'fan out', 'many files', 'multi-module'],
  launch: ['deploy', 'launch', 'release', 'ship', 'publish', 'production'],
  rescue: ['legacy', 'refactor', 'modernize', 'rescue', 'clean up', 'old code', 'messy'],
  scaffold: ['new project', 'bootstrap', 'scaffold', 'greenfield', 'starter', 'from scratch'],

  // L2 workflow skills
  plan: ['plan', 'architect', 'design system', 'roadmap', 'strategy'],
  brainstorm: ['brainstorm', 'ideas', 'alternatives', 'approaches', 'options'],
  debug: ['debug', 'error', 'bug', 'broken', 'trace', 'diagnose', 'crash', 'fail', 'not working', 'stack trace'],
  fix: ['fix', 'patch', 'hotfix', 'resolve', 'repair'],
  test: ['test', 'tdd', 'coverage', 'unit test', 'e2e', 'spec'],
  review: ['review', 'code review', 'check quality', 'audit code', 'look at this code'],
  guardian: ['security', 'vulnerability', 'owasp', 'secret', 'audit security'],
  readiness: ['pre-commit', 'quality gate', 'check before', 'ready to commit'],
  deploy: ['deploy', 'ci/cd', 'pipeline', 'kubernetes', 'docker', 'vercel', 'netlify'],
  design: ['ui', 'ux', 'design', 'layout', 'component design', 'wireframe', 'palette', 'typography'],
  perf: ['performance', 'slow', 'optimize', 'n+1', 'memory leak', 'bundle size'],
  db: ['database', 'migration', 'schema', 'sql', 'sql query', 'database index'],
  audit: ['audit', 'health check', 'project assessment', 'codebase review'],
  onboard: ['onboard', 'get started', 'configure project', 'claude.md'],
  docs: ['document', 'readme', 'api docs', 'changelog'],
  idea: ['requirements', 'business analysis', 'user stories', 'stakeholder'],
  adversary: ['red team', 'challenge', 'stress test', 'edge case', 'poke holes'],
  incident: ['incident', 'outage', 'downtime', 'postmortem', 'production is down'],
  surgeon: ['refactor', 'extract', 'strangler', 'decompose'],
  'mcp-builder': ['mcp', 'mcp server', 'tool server', 'model context'],
  'skill-forge': ['new skill', 'create skill', 'edit skill'],
  'review-intake': ['pr feedback', 'review comments', 'received review', 'triage issues'],
  'logic-guardian': ['business logic', 'protect logic', 'critical path'],
  marketing: ['marketing', 'landing page', 'seo', 'social media', 'landing copy', 'marketing copy'],
  retro: ['retrospective', 'retro', 'sprint review', 'velocity', 'what did we ship'],
  'architecture-mapper': ['architecture map', 'map the architecture', 'map the codebase', 'how the system starts'],
  autopsy: ['autopsy', 'health score', 'tech debt', 'codebase health'],
  documentation: ['jira', 'leadership package', 'stakeholder approval', 'tickets'],
  'improve-architecture': ['shallow module', 'deepen', 'coupling', 'testability', 'architecture improvement'],
  integrate: ['integrate', 'port from', 'port this', 'steal the', 'from that repo'],
  safeguard: ['characterization test', 'safety net', 'rollback point'],
  'org-config': ['org config', 'team roles', 'governance', 'approval flow'],

  // L3 utilities a prompt can name directly
  'asset-creator': ['svg', 'icon', 'og image', 'banner', 'favicon'],
  'browser-pilot': ['browser', 'screenshot', 'playwright', 'click through', 'accessibility tree'],
  'context-lifecycle': ['compaction', 'context window'],
  'dependency-doctor': ['dependencies', 'outdated packages', 'npm audit', 'cve', 'upgrade packages'],
  'doc-processor': ['pdf', 'docx', 'xlsx', 'pptx', 'spreadsheet', 'csv'],
  'docs-seeker': ['api reference', 'library docs', 'method signature', 'deprecated'],
  faq: ['faq', 'where are the docs', 'skill graph'],
  git: ['commit', 'pull request', 'pr', 'branch', 'rebase', 'merge conflict'],
  'guardian-env': ['environment check', 'works on my machine', 'env vars', 'port in use'],
  'hallucination-guard': ['hallucinated', 'phantom import', 'fake package', 'typosquat'],
  journal: ['adr', 'decision record', 'journal', 'log the decision'],
  'neural-memory': ['remember this', 'capture learning', 'neural memory'],
  'problem-solver': ['5 whys', 'root cause analysis', 'first principles', 'fishbone'],
  recall: ['recall', 'what did we do', 'last session', 'remember when'],
  recon: ['where is', 'find', 'search the codebase', 'scan the codebase', 'project structure'],
  research: ['research', 'compare libraries', 'best practice', 'look up'],
  sast: ['static analysis', 'semgrep', 'bandit', 'eslint', 'clippy'],
  'sequential-thinking': ['trade-off', 'tradeoff', 'interdependent', 'second-order'],
  'session-bridge': ['save context', 'save state', 'pick up where', 'next session'],
  slides: ['slides', 'slide deck', 'presentation', 'marp'],
  'trend-scout': ['competitor', 'trending', 'market trends', 'product hunt', 'hacker news'],
  tut: ['tutorial', 'what should i do next'],
  verification: ['verify', 'run the tests', 'lint', 'type check', 'typecheck'],
  'video-creator': ['video', 'storyboard', 'narration', 'youtube', 'shot list'],
  watchdog: ['uptime', 'monitor the site', 'is it up', 'response time'],
};

/**
 * What a skill hands on to, in order, when it runs its usual course: build's
 * phase table (plan → RED → GREEN → quality gates → verify) and skill-router's
 * fallback table (debug → fix, plan → adversary, …). A skill not listed here
 * hands on to nothing predictable.
 * @type {Record<string, string[]>}
 */
export const INTENT_CHAINS = {
  build: ['plan', 'test', 'fix', 'readiness', 'guardian', 'review', 'completion-gate', 'verification'],
  team: ['plan', 'worktree', 'build', 'completion-gate'],
  launch: ['verification', 'deploy', 'watchdog', 'marketing'],
  rescue: ['autopsy', 'safeguard', 'surgeon'],
  scaffold: ['idea', 'plan', 'design', 'fix', 'test', 'docs', 'git', 'verification'],
  plan: ['adversary', 'documentation', 'build'],
  adversary: ['documentation', 'build'],
  documentation: ['build'],
  brainstorm: ['plan'],
  idea: ['plan'],
  debug: ['fix', 'test'],
  fix: ['test', 'readiness'],
  test: ['readiness'],
  review: ['fix'],
  guardian: ['fix'],
  incident: ['debug', 'fix'],
  autopsy: ['safeguard', 'surgeon'],
  deploy: ['watchdog'],
};
