import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { makeTempProject } from './helpers.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, 'bin/effectgate.js');

test('doctor reports config, pending, hooks, and runtime surfaces as json', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);

  const result = spawnSync(process.execPath, [cli, 'doctor', '--json'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.config.found, true);
  assert.equal(report.tripwires, 1);
  assert.equal(report.pending, 0);
  assert.equal(report.surfaces.cli, true);
  assert.equal(report.surfaces.nodeSdk, true);
  assert.equal(report.surfaces.pythonPackage, true);
  assert.equal(report.surfaces.claudeAdapter, true);
  assert.equal(report.surfaces.codexAdapter, true);
});

test('install claude writes a project-local settings file with an EffectGate hook', async () => {
  const cwd = await makeTempProject('');

  const result = spawnSync(process.execPath, [cli, 'install', 'claude'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Installed Claude Code hook/);

  const settings = JSON.parse(await readFile(path.join(cwd, '.claude/settings.local.json'), 'utf8'));
  const hookCommand = settings.hooks.PreToolUse[0].hooks[0].command;
  assert.match(hookCommand, /adapters\/claude\/pre-tool-use\.js/);
  assert.match(hookCommand, /^node /);
});

test('install dry-runs explain codex and desktop setup without mutating project files', async () => {
  const cwd = await makeTempProject('');

  const codex = spawnSync(process.execPath, [cli, 'install', 'codex', '--dry-run'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(codex.status, 0);
  assert.match(codex.stdout, /Codex plugin source/);
  assert.match(codex.stdout, /plugins\/codex\/effectgate/);

  const desktop = spawnSync(process.execPath, [cli, 'install', 'desktop', '--dry-run'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(desktop.status, 0);
  assert.match(desktop.stdout, /swiftc/);
  assert.match(desktop.stdout, /effectgate daemon/);
});
