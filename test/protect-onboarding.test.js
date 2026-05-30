import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/core/config.js';
import { makeTempProject } from './helpers.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, 'bin/effectgate.js');

test('protect creates a tripwire from CLI flags and makes it immediately enforceable', async () => {
  const cwd = await makeTempProject('');

  const protect = spawnSync(process.execPath, [
    cli,
    'protect',
    'billing.charge',
    '--keyword',
    'chargeCustomer',
    '--file',
    'src/billing/**',
    '--risk',
    'money_movement',
    '--max-ttl',
    '20m',
    '--max-calls',
    '2'
  ], { cwd, encoding: 'utf8' });

  assert.equal(protect.status, 0, protect.stderr);
  assert.match(protect.stdout, /Protected billing\.charge/);

  await access(path.join(cwd, '.effectgate/.gitignore'));
  const rawConfig = await readFile(path.join(cwd, '.effectgate.yaml'), 'utf8');
  assert.match(rawConfig, /billing\.charge/);
  assert.match(rawConfig, /chargeCustomer/);

  const config = await loadConfig(cwd);
  assert.equal(config.tripwires.length, 1);
  assert.equal(config.tripwires[0].id, 'billing.charge');
  assert.deepEqual(config.tripwires[0].match.keywords, ['chargeCustomer']);
  assert.deepEqual(config.tripwires[0].match.files, ['src/billing/**']);
  assert.equal(config.tripwires[0].risk, 'money_movement');
  assert.equal(config.tripwires[0].approvals.maxCalls, 2);

  const blocked = spawnSync(process.execPath, [cli, 'check', 'billing.charge', '--args-json', '["cus_123"]'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(blocked.status, 42);
  assert.match(blocked.stderr, /billing\.charge/);

  const pending = JSON.parse(spawnSync(process.execPath, [cli, 'pending', '--json'], {
    cwd,
    encoding: 'utf8'
  }).stdout);
  assert.equal(pending.pending.length, 1);
  assert.equal(pending.pending[0].effectId, 'billing.charge');
});

test('protect merges repeated registrations and list exposes configured tripwires', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    risk: money_movement
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);

  const protect = spawnSync(process.execPath, [
    cli,
    'protect',
    'billing.charge',
    '--keyword',
    'createInvoice',
    '--keyword',
    'chargeCustomer',
    '--sql',
    'INSERT\\\\s+INTO\\\\s+charges',
    '--env',
    'STRIPE_MODE=live'
  ], { cwd, encoding: 'utf8' });

  assert.equal(protect.status, 0, protect.stderr);
  assert.match(protect.stdout, /Updated billing\.charge/);

  const config = await loadConfig(cwd);
  assert.deepEqual(config.tripwires[0].match.keywords, ['chargeCustomer', 'createInvoice']);
  assert.deepEqual(config.tripwires[0].match.sql, ['INSERT\\\\s+INTO\\\\s+charges']);
  assert.deepEqual(config.tripwires[0].when.env, { STRIPE_MODE: 'live' });

  const list = spawnSync(process.execPath, [cli, 'list', '--json'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(list.status, 0, list.stderr);
  const body = JSON.parse(list.stdout);
  assert.equal(body.tripwires.length, 1);
  assert.equal(body.tripwires[0].id, 'billing.charge');
  assert.deepEqual(body.tripwires[0].match.keywords, ['chargeCustomer', 'createInvoice']);
});
