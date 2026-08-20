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
const SESSION_CONTEXT = [
  'Caveman-ultra. Match user language.',
  'Routine final <=120 visible output tokens; status <=60 visible output tokens; plan <=6 bullets and <=180 visible output tokens.',
  'No prompt restatement, recap, tool narration, or duplicate conclusion.',
  'Preserve technical facts, literals, evidence, uncertainty, and safety. Never drop negation.',
  'Exceed only for explicitly requested detail/schema, safety/irreversible clarity, or when uncertainty or required evidence cannot fit; state exception briefly.',
].join(' ');
const SUBAGENT_CONTEXT = [
  'Caveman-ultra. Match user language.',
  'Handoff <=200 visible output tokens.',
  'No prompt restatement, recap, tool narration, or duplicate conclusion.',
  'Preserve technical facts, literals, evidence, uncertainty, and safety. Never drop negation.',
  'Exceed only for explicitly requested detail/schema, safety/irreversible clarity, or when uncertainty or required evidence cannot fit; state exception briefly.',
  'Nested agents inherit.',
].join(' ');
const AGENT_POLICY = [
  'Caveman-ultra. Match user language.',
  'Handoff <=200 visible output tokens. Answer/receipt first.',
  'No prompt restatement, recap, tool narration, or duplicate conclusion.',
  'Preserve technical facts, literals, evidence, uncertainty, and safety. Never drop negation.',
  'Exceed only for explicitly requested detail/schema, safety/irreversible clarity, or when uncertainty or required evidence cannot fit; state exception briefly.',
  'Nested agents inherit.',
].join(' ');

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

function assertStaticHookCommand(hook, event, context) {
  const expectedOutput = {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: context,
    },
  };
  assert.equal(hook.command, `echo '${JSON.stringify(expectedOutput)}'`);

  const shells =
    process.platform === 'win32'
      ? [
          ['PowerShell', 'powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', hook.command]],
          ['Git Bash', 'bash.exe', ['-lc', hook.command]],
        ]
      : [
          ['POSIX sh', '/bin/sh', ['-c', hook.command]],
          ['Bash', 'bash', ['-lc', hook.command]],
        ];

  for (const [name, executable, args] of shells) {
    const result = childProcess.spawnSync(executable, args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(result.status, 0, `${event} ${name}: ${result.error || result.stderr}`);
    assert.equal(result.stderr, '', `${event} ${name}`);
    assert.deepEqual(JSON.parse(result.stdout), expectedOutput, `${event} ${name}`);
  }
}

test('Claude manifests stay unversioned for commit-SHA identity', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  const marketplace = readJson('.claude-plugin/marketplace.json');
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  assert.equal(owns(plugin, 'version'), false);
  assert.equal(owns(marketplace.plugins[0], 'version'), false);
});

test('shared Claude and Gemini descriptor keeps one static SessionStart reminder', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  const descriptor = readJson('hooks/hooks.json');
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  assert.equal(owns(plugin, 'hooks'), false);
  assert.deepEqual(Object.keys(descriptor), ['hooks']);
  assert.deepEqual(Object.keys(descriptor.hooks), ['SessionStart']);
  assert.equal(descriptor.hooks.SessionStart.length, 1);
  assert.deepEqual(Object.keys(descriptor.hooks.SessionStart[0]), ['hooks']);
  assert.equal(descriptor.hooks.SessionStart[0].hooks.length, 1);

  const hook = descriptor.hooks.SessionStart[0].hooks[0];
  assert.deepEqual(Object.keys(hook).sort(), ['command', 'type']);
  assert.equal(hook.type, 'command');
  assert.doesNotMatch(
    hook.command,
    /\bnode(?:\.exe)?\b|\bPATH\b|CLAUDE_PLUGIN_ROOT|extensionPath|UserPromptSubmit/,
  );

  assertStaticHookCommand(hook, 'SessionStart', SESSION_CONTEXT);
});

test('Claude-only settings candidate adds one static SubagentStart reminder', () => {
  const descriptor = readJson('hooks/claude-subagent-start.json');

  assert.deepEqual(Object.keys(descriptor), ['hooks']);
  assert.deepEqual(Object.keys(descriptor.hooks), ['SubagentStart']);
  assert.equal(descriptor.hooks.SubagentStart.length, 1);
  assert.deepEqual(Object.keys(descriptor.hooks.SubagentStart[0]), ['hooks']);
  assert.equal(descriptor.hooks.SubagentStart[0].hooks.length, 1);

  const hook = descriptor.hooks.SubagentStart[0].hooks[0];
  assert.deepEqual(Object.keys(hook).sort(), ['command', 'type']);
  assert.equal(hook.type, 'command');
  assert.doesNotMatch(
    hook.command,
    /\bnode(?:\.exe)?\b|\bPATH\b|CLAUDE_PLUGIN_ROOT|extensionPath|UserPromptSubmit|PreToolUse/,
  );

  assertStaticHookCommand(hook, 'SubagentStart', SUBAGENT_CONTEXT);
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
    assert.match(content, new RegExp(AGENT_POLICY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), filename);
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
    /Routine final <=120 visible output tokens; status <=60 visible output tokens; plan <=6 bullets and <=180 visible output tokens; agent handoff <=200 visible output tokens\./,
  );
  assert.match(
    skill,
    /No prompt restatement, recap, tool narration, or duplicate conclusion\./,
  );
  assert.match(
    skill,
    /Preserve technical facts, literals, evidence, uncertainty, and safety\. Never drop negation\./,
  );
  assert.match(
    skill,
    /Exceed only for explicitly requested detail\/schema, safety\/irreversible clarity, or when uncertainty or required evidence cannot fit; state exception briefly\./,
  );
  assert.match(
    skill,
    /Plans, task packets, status, and handoffs intended for agent reuse use Caveman-ultra\. Code\/comments\/commits\/PRs\/user docs\/memory\/third-party prose stay normal unless asked \(`\/caveman-compress` exempt\)\. Stop phrases disable; otherwise level persists for session\./,
  );
  assert.doesNotMatch(skill, /Persisted outside chat: write normal prose/);
  assert.equal(read('plugins/caveman/skills/caveman/SKILL.md'), skill, 'Caveman skill mirror drifted');
});

test('Cavecrew skill gives every handoff the same compact budget', () => {
  const skill = read('skills/cavecrew/SKILL.md');

  assert.match(skill, /Handoff <=200 visible output tokens\./);
  assert.match(skill, /No prompt restatement, recap, tool narration, or duplicate conclusion\./);
  assert.match(
    skill,
    /Preserve technical facts, literals, evidence, uncertainty, and safety\. Never drop negation\./,
  );
  assert.match(
    skill,
    /Exceed only for explicitly requested detail\/schema, safety\/irreversible clarity, or when uncertainty or required evidence cannot fit; state exception briefly\./,
  );
  assert.equal(read('plugins/caveman/skills/cavecrew/SKILL.md'), skill, 'Cavecrew skill mirror drifted');
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
