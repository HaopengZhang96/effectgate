import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempProject, readJsonl } from './helpers.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, 'bin/effectgate.js');

test('effectgate run blocks matching command before execution and records audit', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: prod-backfill
    match:
      keywords: ["backfillProd"]
    action: ask
`);

  const result = spawnSync(process.execPath, [cli, 'run', '--', process.execPath, '-e', 'console.log("backfillProd executed")'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 42);
  assert.match(result.stderr, /EffectGate blocked a protected effect/);
  assert.doesNotMatch(result.stdout, /backfillProd executed/);

  const audit = await readJsonl(path.join(cwd, '.effectgate', 'audit.jsonl'));
  assert.equal(audit[0].decision, 'ask');
  assert.equal(audit[0].matches[0].id, 'prod-backfill');
});

test('effectgate run executes low-risk command and approved matching command', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: prod-backfill
    match:
      keywords: ["backfillProd"]
    action: ask
`);

  const safe = spawnSync(process.execPath, [cli, 'run', '--', process.execPath, '-e', 'console.log("safe")'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(safe.status, 0);
  assert.match(safe.stdout, /safe/);

  const approve = spawnSync(process.execPath, [cli, 'approve', 'prod-backfill', '--ttl', '10m', '--max-calls', '1', '--scope', 'session'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(approve.status, 0);

  const allowed = spawnSync(process.execPath, [cli, 'run', '--', process.execPath, '-e', 'console.log("backfillProd executed")'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(allowed.status, 0);
  assert.match(allowed.stdout, /backfillProd executed/);
});

test('effectgate check blocks exact runtime effect without approval', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: charge-customer
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);

  const result = spawnSync(process.execPath, [cli, 'check', 'charge-customer', '--args-json', '{"customer":"c1"}'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 42);
  assert.match(result.stderr, /charge-customer/);
});
