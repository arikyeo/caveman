#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const AGENTS = [
  'cavecrew-investigator.md',
  'cavecrew-builder.md',
  'cavecrew-reviewer.md',
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function readGeneratedSkill(name) {
  const source = read('packages/cli/src/agent-skills.generated.ts');
  const match = new RegExp(`^  ${JSON.stringify(name)}: (.+),$`, 'm').exec(source);
  assert.ok(match, `${name} missing from CLI generated skills`);
  return JSON.parse(match[1]);
}

test('Claude manifests stay unversioned for commit-SHA identity', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  const marketplace = readJson('.claude-plugin/marketplace.json');
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  assert.equal(owns(plugin, 'version'), false);
  assert.equal(owns(marketplace.plugins[0], 'version'), false);
});

test('shared Claude and Gemini descriptor adds one session-only Caveman reminder', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  const descriptor = readJson('hooks/hooks.json');
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const expectedContext = [
    'Replies, plans, and subagent prose: English Caveman-ultra.',
    'Terse fragments; preserve all technical facts, literals, evidence, uncertainty, and safety.',
    'Clarity overrides brevity. Nested agents inherit.',
  ].join(' ');

  assert.equal(owns(plugin, 'hooks'), false);
  assert.deepEqual(Object.keys(descriptor), ['hooks']);
  assert.deepEqual(Object.keys(descriptor.hooks), ['SessionStart']);
  assert.equal(descriptor.hooks.SessionStart.length, 1);
  assert.deepEqual(Object.keys(descriptor.hooks.SessionStart[0]), ['hooks']);
  assert.equal(descriptor.hooks.SessionStart[0].hooks.length, 1);

  const hook = descriptor.hooks.SessionStart[0].hooks[0];
  assert.deepEqual(Object.keys(hook).sort(), ['command', 'type']);
  assert.equal(hook.type, 'command');
  assert.doesNotMatch(hook.command, /CLAUDE_PLUGIN_ROOT|extensionPath|UserPromptSubmit/);

  const result = childProcess.spawnSync(hook.command, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: expectedContext,
    },
  });
});

test('installer describes session-only plugin behavior without implying a per-prompt hook', () => {
  const installer = read('bin/install.js');
  const claude = read('CLAUDE.md');
  const installGuide = read('INSTALL.md');
  const readme = read('README.md');

  assert.match(
    installer,
    /hooks: plugin default hooks file handles SessionStart \(no per-prompt hook\)/,
  );
  assert.match(
    installer,
    /pass --with-hooks to add standalone SessionStart \+ UserPromptSubmit tracking/,
  );
  assert.doesNotMatch(
    installer,
    /plugin default hooks file handles SessionStart \+ UserPromptSubmit/,
  );
  assert.match(claude, /hooks\/hooks\.json\s+# Shared Claude\/Gemini SessionStart descriptor/);
  assert.match(
    claude,
    /Plugin install.*shared Claude\/Gemini descriptor adds one compact SessionStart reminder\./,
  );
  assert.match(
    claude,
    /UserPromptSubmit is not installed by default; `--with-hooks` opts into standalone tracking\./,
  );
  assert.match(
    installGuide,
    /Default: auto; successful plugin install keeps only the shared SessionStart reminder\./,
  );
  assert.match(
    readme,
    /`\/caveman-stats`.*Requires standalone tracking via `--with-hooks`\./,
  );
});

test('canonical and plugin agent copies are byte-identical', () => {
  for (const filename of AGENTS) {
    assert.equal(
      read(`plugins/caveman/agents/${filename}`),
      read(`agents/${filename}`),
      `${filename} mirror drifted`,
    );
  }
});

test('all cavecrew agents inherit compact language-safe Caveman-ultra policy', () => {
  for (const filename of AGENTS) {
    const content = read(`agents/${filename}`);
    assert.match(
      content,
      /Caveman-ultra, user's language\. Minimize tokens; answer\/receipt first\. No restatement\/tool narration\. Preserve technical literals verbatim\. Nested agents inherit\. Full clarity for security\/irreversible work\./,
      filename,
    );
    assert.doesNotMatch(content, /wenyan/i, `${filename} must not force Wenyan`);
  }
});

test('builder keeps requested model and effort', () => {
  const builder = read('agents/cavecrew-builder.md');
  assert.match(builder, /^model: sonnet$/m);
  assert.match(builder, /^effort: medium$/m);
});

test('Caveman skill defaults all agent-facing prose to ultra', () => {
  const skill = read('skills/caveman/SKILL.md');

  assert.match(skill, /ultra \(default\)/);
  assert.doesNotMatch(skill, /full \(default\)/);
  assert.match(skill, /Default: \*\*ultra\*\*\./);
  assert.match(skill, /Nested agents inherit\./);
  assert.match(skill, /Wenyan modes: opt-in only\. Never default\./);
  assert.match(
    skill,
    /Plans, task packets, status, and handoffs intended for agent reuse use Caveman-ultra\. Code\/comments\/commits\/PRs\/user docs\/memory\/third-party prose stay normal unless asked \(`\/caveman-compress` exempt\)\. Stop phrases disable; otherwise level persists for session\./,
  );
  assert.doesNotMatch(skill, /Persisted outside chat: write normal prose/);
  assert.equal(read('plugins/caveman/skills/caveman/SKILL.md'), skill, 'Caveman skill mirror drifted');
});

test('ultra examples preserve explicit causality without invented abbreviations', () => {
  const skill = read('skills/caveman/SKILL.md');

  assert.match(
    skill,
    /- ultra: "New object prop reference triggers re-render\. `useMemo`\."/,
  );
  assert.match(
    skill,
    /- ultra: "Pool reuses DB connections\. No handshake per request\."/,
  );
  assert.doesNotMatch(skill, /Inline obj prop/);
});

test('CLI generated Caveman skill equals canonical ultra-default skill', () => {
  const generated = readGeneratedSkill('caveman');
  assert.equal(generated, read('skills/caveman/SKILL.md'));
  assert.match(generated, /Default: \*\*ultra\*\*\./);
});

test('bare /caveman surfaces advertise ultra as default', () => {
  assert.match(read('commands/caveman.md'), /If no level specified, use ultra\./);
  assert.match(read('commands/caveman.toml'), /If no level specified, use ultra\./);
  assert.match(read('src/plugins/opencode/commands/caveman.md'), /If no level given, use ultra\./);
  assert.match(read('src/plugins/opencode/commands/caveman-help.md'), /`\/caveman` \| Activate at default level \(ultra\)/);

  const skillReadme = read('skills/caveman/README.md');
  assert.match(skillReadme, /\| `ultra` \| Default\./);
  assert.match(skillReadme, /\/caveman\s+# ultra mode \(default\)/);

  const helpSkill = read('skills/caveman-help/SKILL.md');
  assert.match(helpSkill, /\| \*\*Full\*\* \| `\/caveman full`/);
  assert.match(helpSkill, /\| \*\*Ultra\*\* \| `\/caveman` .* Default\./);
  assert.match(helpSkill, /Default mode = `ultra`\./);
  assert.match(helpSkill, /Resolution: env var > config file > `ultra`\./);
  assert.match(read('skills/caveman-help/README.md'), /\/caveman\s+ultra \(default\)/);
});

test('Claude hook documentation names ultra runtime default', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /SessionStart hook ──writes "ultra"──▶/);
  assert.match(claude, /→ `'ultra'`\./);
  assert.match(claude, /defaults to `ultra`/);
  assert.match(claude, /`ultra` \(default\)/);

  const hooks = read('src/hooks/README.md');
  assert.match(hooks, /Writes `ultra` to `\$CLAUDE_CONFIG_DIR\/\.caveman-active`/);
  assert.match(hooks, /SessionStart hook ──writes "ultra"──▶/);
});

test('OpenClaw source and standalone bootstrap are identical ultra defaults', () => {
  const helper = require(path.join(ROOT, 'bin/lib/openclaw.js'));
  const canonical = read('src/rules/caveman-openclaw-bootstrap.md');
  assert.equal(helper.loadBootstrapSnippet(ROOT), canonical);
  assert.equal(helper.loadBootstrapSnippet(), canonical);
  assert.match(canonical, /Default intensity: `ultra`\./);
});
