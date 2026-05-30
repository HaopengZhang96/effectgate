import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempProject } from './helpers.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, 'bin/effectgate.js');

test('bar --json --once returns machine-readable status for shell status bars', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);

  spawnSync(process.execPath, [cli, 'check', 'billing.charge', '--args-json', '["cus_123"]'], {
    cwd,
    encoding: 'utf8'
  });

  const result = spawnSync(process.execPath, [cli, 'bar', '--once', '--json'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  const status = JSON.parse(result.stdout);
  assert.equal(status.pendingCount, 1);
  assert.equal(status.attention, true);
  assert.equal(status.effects[0], 'billing.charge');
  assert.match(status.label, /billing\.charge/);
});

test('install cli-bar writes an executable project helper script', async () => {
  const cwd = await makeTempProject('');

  const result = spawnSync(process.execPath, [cli, 'install', 'cli-bar'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Installed CLI bar helper/);

  const script = path.join(cwd, '.effectgate/effectgate-bar.sh');
  const scriptText = await readFile(script, 'utf8');
  const scriptStat = await stat(script);
  assert.match(scriptText, /bar --once/);
  assert.match(scriptText, /--recent/);
  assert.ok((scriptStat.mode & 0o111) !== 0);
});

test('installed cli-bar helper shows recently executed protected effects by default', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);

  const install = spawnSync(process.execPath, [cli, 'install', 'cli-bar'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(install.status, 0, install.stderr);

  const approve = spawnSync(process.execPath, [cli, 'approve', 'billing.charge', '--ttl', '10m', '--max-calls', '1', '--scope', 'session'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(approve.status, 0, approve.stderr);

  const allowed = spawnSync(process.execPath, [cli, 'check', 'billing.charge', '--args-json', '["cus_recent"]'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(allowed.status, 0, allowed.stderr);

  const script = path.join(cwd, '.effectgate/effectgate-bar.sh');
  const helper = spawnSync(script, ['--json'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(helper.status, 0, helper.stderr);
  const body = JSON.parse(helper.stdout);
  assert.equal(body.pendingCount, 0);
  assert.equal(body.recentCount, 1);
  assert.deepEqual(body.recentEffects, ['billing.charge']);
});

test('setup can initialize config, Claude hook, and CLI bar helper in one command', async () => {
  const cwd = await makeTempProject('');

  const result = spawnSync(process.execPath, [cli, 'setup', '--claude', '--cli-bar'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Created .effectgate.yaml/);
  assert.match(result.stdout, /Installed Claude Code hook/);
  assert.match(result.stdout, /Installed CLI bar helper/);

  await stat(path.join(cwd, '.effectgate.yaml'));
  await stat(path.join(cwd, '.claude/settings.local.json'));
  await stat(path.join(cwd, '.effectgate/effectgate-bar.sh'));
});

test('setup can register a protected effect and install the cli bar in one command', async () => {
  const cwd = await makeTempProject('');

  const result = spawnSync(process.execPath, [
    cli,
    'setup',
    '--protect',
    'billing.charge',
    '--keyword',
    'chargeCustomer',
    '--risk',
    'money_movement',
    '--cli-bar'
  ], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Protected billing\.charge/);
  assert.match(result.stdout, /Installed CLI bar helper/);
  assert.match(result.stdout, /verify-install billing\.charge --surface cli/);

  const list = spawnSync(process.execPath, [cli, 'list', '--json'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(list.status, 0, list.stderr);
  const body = JSON.parse(list.stdout);
  assert.deepEqual(body.tripwires.map((tripwire) => tripwire.id), ['billing.charge']);
  assert.deepEqual(body.tripwires[0].match.keywords, ['chargeCustomer']);
  assert.equal(body.tripwires[0].risk, 'money_movement');

  await stat(path.join(cwd, '.effectgate/effectgate-bar.sh'));
});

test('setup --dry-run reports actions without writing project files', async () => {
  const cwd = await makeTempProject('');

  const result = spawnSync(process.execPath, [cli, 'setup', '--claude', '--cli-bar', '--dry-run'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Would create .effectgate.yaml/);
  assert.match(result.stdout, /Would install Claude Code hook/);
  assert.match(result.stdout, /Would install CLI bar helper/);

  await assert.rejects(access(path.join(cwd, '.effectgate.yaml')));
  await assert.rejects(access(path.join(cwd, '.claude/settings.local.json')));
  await assert.rejects(access(path.join(cwd, '.effectgate/effectgate-bar.sh')));
});
