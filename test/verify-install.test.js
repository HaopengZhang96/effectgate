import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempProject } from './helpers.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, 'bin/effectgate.js');

test('verify-install proves config, test alert, CLI bar, and daemon pending path', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    risk: money_movement
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);

  const result = spawnSync(process.execPath, [cli, 'verify-install', 'billing.charge', '--json'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.effectId, 'billing.charge');
  assert.equal(body.ok, true);
  assert.equal(body.checks.config.ok, true);
  assert.equal(body.checks.testAlert.ok, true);
  assert.equal(body.checks.cliBar.ok, true);
  assert.equal(body.checks.daemon.ok, true);
  assert.match(body.checks.cliBar.label, /billing\.charge/);
  assert.equal(body.pendingCount, 1);

  const bar = spawnSync(process.execPath, [cli, 'bar', '--once'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(bar.status, 2);
  assert.match(bar.stdout, /billing\.charge/);
});

test('verify-install prints a human-readable checklist', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: tenant.delete
    match:
      keywords: ["deleteTenant"]
    action: ask
`);

  const result = spawnSync(process.execPath, [cli, 'verify-install'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /EffectGate install verification/);
  assert.match(result.stdout, /Config: ok/);
  assert.match(result.stdout, /Test alert: ok/);
  assert.match(result.stdout, /CLI bar: ok/);
  assert.match(result.stdout, /Daemon API: ok/);
  assert.match(result.stdout, /tenant\.delete/);
});

test('verify-install fails closed with actionable guidance when no matching tripwire exists', async () => {
  const empty = await makeTempProject('');
  const missingConfig = spawnSync(process.execPath, [cli, 'verify-install', '--json'], {
    cwd: empty,
    encoding: 'utf8'
  });
  assert.equal(missingConfig.status, 1);
  const missingBody = JSON.parse(missingConfig.stdout);
  assert.equal(missingBody.ok, false);
  assert.equal(missingBody.checks.config.ok, false);
  assert.match(missingBody.next, /effectgate protect/);

  const configured = await makeTempProject(`
tripwires:
  - id: billing.charge
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);
  const unknown = spawnSync(process.execPath, [cli, 'verify-install', 'tenant.delete'], {
    cwd: configured,
    encoding: 'utf8'
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /No configured tripwire found for tenant\.delete/);
  assert.match(unknown.stderr, /effectgate list/);
});

test('verify-install --surface cli verifies the project CLI bar helper is installed', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);

  const missing = spawnSync(process.execPath, [cli, 'verify-install', 'billing.charge', '--surface', 'cli', '--json'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(missing.status, 1);
  const missingBody = JSON.parse(missing.stdout);
  assert.equal(missingBody.checks.surfaces.cli.ok, false);
  assert.match(missingBody.checks.surfaces.cli.next, /effectgate install cli-bar/);

  const install = spawnSync(process.execPath, [cli, 'install', 'cli-bar'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(install.status, 0, install.stderr);

  const verified = spawnSync(process.execPath, [cli, 'verify-install', 'billing.charge', '--surface', 'cli', '--json'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(verified.status, 0, verified.stderr);
  const body = JSON.parse(verified.stdout);
  assert.equal(body.checks.surfaces.cli.ok, true);
  assert.match(body.checks.surfaces.cli.path, /\.effectgate\/effectgate-bar\.sh$/);
  assert.equal(body.checks.surfaces.cli.recentWindow, '24h');
});

test('verify-install --surface desktop verifies project LaunchAgents and daemon URL wiring', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);
  const home = await mkdtemp(path.join(tmpdir(), 'effectgate-home-'));

  const missing = spawnSync(process.execPath, [cli, 'verify-install', 'billing.charge', '--surface', 'desktop', '--home', home, '--json'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(missing.status, 1);
  const missingBody = JSON.parse(missing.stdout);
  assert.equal(missingBody.checks.surfaces.desktop.ok, false);
  assert.match(missingBody.checks.surfaces.desktop.next, /effectgate install desktop/);

  const install = spawnSync(process.execPath, [cli, 'install', 'desktop', '--home', home, '--port', '9555'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(install.status, 0, install.stderr);

  const verified = spawnSync(process.execPath, [cli, 'verify-install', 'billing.charge', '--surface', 'desktop', '--home', home, '--json'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(verified.status, 0, verified.stderr);
  const body = JSON.parse(verified.stdout);
  assert.equal(body.checks.surfaces.desktop.ok, true);
  assert.equal(body.checks.surfaces.desktop.daemonUrl, 'http://127.0.0.1:9555');
  assert.equal(body.checks.surfaces.desktop.selfTest.ok, true);
  assert.match(body.checks.surfaces.desktop.selfTest.stdout, /billing\.charge/);
  assert.match(body.checks.surfaces.desktop.daemonPlist, /daemon\.plist$/);
  assert.match(body.checks.surfaces.desktop.barPlist, /bar\.plist$/);
});
