import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAudit } from '../src/core/audit.js';
import { startDaemon } from '../src/daemon/server.js';
import { makeTempProject } from './helpers.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, 'bin/effectgate.js');

test('test-alert creates a safe pending alert visible in the CLI bar and daemon API', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    risk: money_movement
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);

  const result = spawnSync(process.execPath, [cli, 'test-alert', 'billing.charge', '--args-json', '["cus_test"]'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created test alert for billing\.charge/);
  assert.match(result.stdout, /EffectGate: 1 pending - billing\.charge/);

  const bar = spawnSync(process.execPath, [cli, 'bar', '--once', '--json'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(bar.status, 2);
  const barJson = JSON.parse(bar.stdout);
  assert.equal(barJson.pendingCount, 1);
  assert.deepEqual(barJson.effects, ['billing.charge']);

  const server = await startDaemon({ cwd, port: 0 });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/pending`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.pending.length, 1);
    assert.equal(body.pending[0].effectId, 'billing.charge');
    assert.match(body.bar, /billing\.charge/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const audit = await readAudit(cwd, 10);
  assert.equal(audit.at(-1).kind, 'test_alert');
  assert.equal(audit.at(-1).effectId, 'billing.charge');
});

test('test-alert defaults to the first configured effect and refuses unknown effects', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: tenant.delete
    match:
      keywords: ["deleteTenant"]
    action: ask
`);

  const implicit = spawnSync(process.execPath, [cli, 'test-alert'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(implicit.status, 0, implicit.stderr);
  assert.match(implicit.stdout, /tenant\.delete/);

  const implicitWithFlag = spawnSync(process.execPath, [cli, 'test-alert', '--args-json', '["tenant-123"]'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(implicitWithFlag.status, 0, implicitWithFlag.stderr);
  assert.match(implicitWithFlag.stdout, /tenant\.delete/);

  const unknown = spawnSync(process.execPath, [cli, 'test-alert', 'missing.effect'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /No configured tripwire found for missing\.effect/);
});

test('daemon summary includes recent executed protected effects', async () => {
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

  const server = await startDaemon({ cwd, port: 0 });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/summary?recent=1h`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.pending.length, 0);
    assert.equal(body.recent.length, 1);
    assert.equal(body.recent[0].effectId, 'billing.charge');
    assert.match(body.bar, /recent/);
    assert.match(body.bar, /billing\.charge/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
