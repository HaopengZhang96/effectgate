import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempProject } from './helpers.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, 'bin/effectgate.js');

test('blocked runtime effects create pending alerts shown by the cli bar and cleared by approval', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    risk: money_movement
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);

  const blocked = spawnSync(process.execPath, [cli, 'check', 'billing.charge', '--args-json', '["cus_123"]'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(blocked.status, 42);

  const pending = spawnSync(process.execPath, [cli, 'pending', '--json'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(pending.status, 0);
  const pendingJson = JSON.parse(pending.stdout);
  assert.equal(pendingJson.pending.length, 1);
  assert.equal(pendingJson.pending[0].effectId, 'billing.charge');
  assert.equal(pendingJson.pending[0].status, 'pending');

  const bar = spawnSync(process.execPath, [cli, 'bar', '--once'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(bar.status, 2);
  assert.match(bar.stdout, /1 pending/);
  assert.match(bar.stdout, /billing\.charge/);

  const approve = spawnSync(process.execPath, [cli, 'approve', 'billing.charge', '--ttl', '10m', '--max-calls', '1', '--scope', 'session'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(approve.status, 0);

  const cleanBar = spawnSync(process.execPath, [cli, 'bar', '--once'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(cleanBar.status, 0);
  assert.match(cleanBar.stdout, /no pending effects/i);
});

test('pending alerts can be denied explicitly', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: prod-delete
    match:
      keywords: ["deleteTenant"]
    action: ask
`);

  const blocked = spawnSync(process.execPath, [cli, 'run', '--', process.execPath, '-e', 'console.log("deleteTenant")'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(blocked.status, 42);

  const before = JSON.parse(spawnSync(process.execPath, [cli, 'pending', '--json'], {
    cwd,
    encoding: 'utf8'
  }).stdout);
  assert.equal(before.pending.length, 1);

  const denied = spawnSync(process.execPath, [cli, 'deny', before.pending[0].id], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(denied.status, 0);

  const after = JSON.parse(spawnSync(process.execPath, [cli, 'pending', '--json'], {
    cwd,
    encoding: 'utf8'
  }).stdout);
  assert.equal(after.pending.length, 0);
});

test('bar can show recently executed protected effects without creating pending attention', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);

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

  const text = spawnSync(process.execPath, [cli, 'bar', '--once', '--recent', '1h'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(text.status, 0);
  assert.match(text.stdout, /recent/);
  assert.match(text.stdout, /billing\.charge/);

  const json = spawnSync(process.execPath, [cli, 'bar', '--once', '--json', '--recent', '1h'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(json.status, 0);
  const body = JSON.parse(json.stdout);
  assert.equal(body.attention, false);
  assert.equal(body.pendingCount, 0);
  assert.equal(body.recentCount, 1);
  assert.deepEqual(body.recentEffects, ['billing.charge']);
});
