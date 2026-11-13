/**
 * intent-keywords.js — the words in a prompt that point at each Topia skill
 *
 * One source for the compiled skill-index (`intents`, read by the intent-router
 * hook) and for the prompt-routing mod (mods/lib/skill-routes.generated.ts).
 * Phrases come from each skill's description and skill-router's Request
 * Classifier and Power User tables. The mod matches them on word boundaries
 * (a trailing s/es/ed/d/ing allowed), so keep them whole words or phrases.
 *
 * Each phrase belongs to one skill: no keyword may appear in two skills, nor
 * inside another skill's phrase (the tests check). Prefer phrases a person
 * would only type for that skill. Words like "add", "make", "find", "error",
 * "test", "clean up", or "deploy" for launch match almost any prompt and
 * send it to the wrong skill.
 * An apostrophe matches straight, curly or left out ("what's", "what’s", "whats").
 */

/** @type {Record<string, string[]>} */
export const INTENT_KEYWORDS = {
  // L1 orchestrators
  build: ['implement', 'new feature', 'add a feature', 'add support for', 'build a feature', 'build out'],
  team: ['in parallel', 'split this up', 'do all of these', 'fan out', 'many files', 'multi-module'],
  launch: ['launch the product', 'product launch', 'go live', 'ship it', 'ship to production', 'launch and announce'],
  rescue: [
    'legacy code',
    'legacy app',
    'modernize',
    'rescue',
    'old code',
    'clean up this mess',
    'messy codebase',
    'unmaintainable',
  ],
  scaffold: ['new project', 'bootstrap a project', 'scaffold', 'greenfield', 'starter project', 'from scratch'],

  // L2 workflow skills
  plan: ['plan', 'implementation plan', 'roadmap', 'into phases', 'master plan'],
  brainstorm: [
    'brainstorm',
    'what are our options',
    'other approaches',
    'different approaches',
    'alternative approaches',
    'ways to solve',
  ],
  debug: [
    'debug',
    'bug',
    'broken',
    'diagnose',
    'crash',
    'not working',
    'stack trace',
    'exception',
    'fails with',
    'error message',
  ],
  fix: ['fix', 'hotfix', 'repair', 'apply the fix', 'apply the change'],
  test: ['tdd', 'coverage', 'unit test', 'integration test', 'e2e', 'add test', 'write test', 'failing test first'],
  review: [
    'code review',
    'review my changes',
    'review this pr',
    'review the diff',
    'review this code',
    'look at this code',
  ],
  guardian: ['security', 'security audit', 'security scan', 'vulnerability', 'owasp', 'secret', 'leaked secret'],
  readiness: ['pre-commit', 'quality gate', 'check before', 'ready to commit'],
  deploy: ['deploy', 'ci/cd', 'ci pipeline', 'kubernetes', 'vercel', 'netlify', 'push to production'],
  design: [
    'ui design',
    'ux',
    'design system',
    'component design',
    'wireframe',
    'palette',
    'typography',
    'visual style',
    'look and feel',
  ],
  perf: ['performance', 'slow', 'n+1', 'memory leak', 'bundle size', 'speed up'],
  db: [
    'database',
    'sql',
    'database migration',
    'schema migration',
    'migration file',
    'database schema',
    'add a column',
    'database index',
  ],
  audit: [
    'audit this repo',
    'audit the project',
    'project audit',
    'full audit',
    'health check',
    'project assessment',
    'codebase review',
  ],
  onboard: ['onboard', 'claude.md', 'new to this repo', 'set up this project for claude'],
  docs: [
    'readme',
    'api docs',
    'changelog',
    'update the docs',
    'write docs',
    'document this',
    'architecture docs',
    'show and tell',
    'show-and-tell',
    'walk me through',
    'walkthrough',
  ],
  idea: ['requirements', 'gather requirements', 'business analysis', 'vague idea', 'what should this feature do'],
  adversary: ['red team', 'red-team', 'poke holes', 'what could go wrong', 'challenge this design', "devil's advocate"],
  incident: ['incident', 'outage', 'downtime', 'postmortem', 'production is down'],
  surgeon: ['refactor', 'strangler fig', 'branch by abstraction', 'god class', 'extract a module', 'extract into'],
  'mcp-builder': ['mcp server', 'build an mcp', 'model context protocol', 'tool server'],
  'skill-forge': ['new skill', 'create skill', 'create a skill', 'edit skill', 'skill authoring'],
  'review-intake': ['pr feedback', 'review comments', 'received review', 'triage issues'],
  'logic-guardian': ['business logic', 'protect logic', 'payment logic', 'billing logic', 'state machine'],
  marketing: ['marketing', 'landing page', 'seo', 'social media', 'landing copy', 'marketing copy'],
  retro: ['retrospective', 'retro', 'sprint review', 'velocity', 'what did we ship'],
  'architecture-mapper': ['architecture map', 'map the architecture', 'map the codebase', 'how the system starts'],
  autopsy: ['autopsy', 'health score', 'tech debt', 'codebase health'],
  documentation: ['jira', 'jira tickets', 'leadership package', 'stakeholder approval', 'user stories'],
  'improve-architecture': [
    'shallow module',
    'deepen',
    'coupling',
    'testability',
    'architecture improvement',
    'improve the architecture',
  ],
  integrate: ['port from', 'port this', 'steal the', 'from that repo', 'from another repo'],
  safeguard: ['characterization test', 'safety net', 'rollback point'],
  'org-config': ['org config', 'team roles', 'governance', 'approval flow'],
  stack: [
    'docker compose',
    'compose stack',
    'container logs',
    'restart the stack',
    'rebuild the container',
    'server.sh',
    'env.example',
    'published ports',
  ],

  // L3 utilities a prompt can name directly
  'asset-creator': ['svg', 'svg icon', 'icon set', 'og image', 'social banner', 'favicon'],
  'browser-pilot': [
    'in the browser',
    'in a real browser',
    'screenshot',
    'playwright',
    'click through',
    'accessibility tree',
    'console errors',
  ],
  'context-lifecycle': ['compaction', 'context window'],
  'decision-form': [
    'decision form',
    'form for these',
    'answer in a browser',
    'batch of decisions',
    'questions as a form',
  ],
  'dependency-doctor': [
    'outdated dependencies',
    'dependency update',
    'outdated packages',
    'vulnerable packages',
    'npm audit',
    'cve',
    'upgrade packages',
  ],
  'doc-processor': ['pdf', 'docx', 'xlsx', 'pptx', 'spreadsheet', 'csv'],
  'docs-seeker': ['api reference', 'library docs', 'method signature', 'deprecated'],
  faq: ['faq', 'where are the docs', 'skill graph'],
  git: [
    'commit message',
    'commit the changes',
    'commit this',
    'pull request',
    'pr description',
    'open a pr',
    'rebase',
    'merge conflict',
    'branch name',
    'new branch',
  ],
  'guardian-env': ['environment check', 'works on my machine', 'env vars', 'port in use'],
  'hallucination-guard': ['hallucinated', 'phantom import', 'fake package', 'typosquat'],
  journal: ['adr', 'decision record', 'journal', 'log the decision', 'remember this', 'capture learning'],
  'neural-memory': ['neural memory', 'nmem'],
  'problem-solver': ['5 whys', 'root cause analysis', 'first principles', 'fishbone'],
  recall: [
    'recall',
    'what did we do',
    'last session',
    'remember when',
    'where did we leave off',
    'where we left off',
    'where were we',
    "what's left",
    'what is left',
    'pick up where',
    'resume where',
    'resume work',
    "let's resume",
  ],
  recon: [
    'search the codebase',
    'scan the codebase',
    'project structure',
    'which file',
    'where in the codebase',
    'codebase map',
  ],
  research: ['research', 'compare libraries', 'best practice', 'look up'],
  sast: ['static analysis', 'semgrep', 'bandit', 'eslint', 'clippy'],
  'sequential-thinking': ['trade-off', 'tradeoff', 'interdependent', 'second-order'],
  'session-bridge': ['save context', 'save state', 'next session'],
  slides: ['slides', 'slide deck', 'presentation', 'marp'],
  'trend-scout': ['competitor', 'trending', 'market trends', 'product hunt', 'hacker news'],
  tut: ['tutorial', 'what should i do next'],
  verification: ['verify', 'run the tests', 'lint', 'type check', 'typecheck'],
  'video-creator': ['video', 'storyboard', 'narration', 'youtube', 'shot list'],
  watchdog: ['uptime', 'monitor the site', 'is it up', 'response time'],
};

/**
 * Phrases that point at a skill only when they are the whole prompt, give or
 * take spaces and a closing ? . or !: "status" alone asks where work stands,
 * while "git status" or "HTTP status code" does not. Same matching otherwise,
 * with no plain endings.
 * @type {Record<string, string[]>}
 */
export const INTENT_PROMPTS = {
  recall: ['status', 'status update', "what's the status", 'where are we', 'where are we at', 'resume'],
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
