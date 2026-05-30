import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { evaluateOperation, scanSqlText } from '../src/core/matcher.js';
import { makeTempProject, writeProjectFile } from './helpers.js';

test('loads tripwires from .effectgate.yaml and matches command keywords under env conditions', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: prod-db-delete
    match:
      keywords: ["deleteTenant", "dropUserData"]
      files: ["src/**"]
    when:
      env:
        DATABASE_URL: "*prod*"
    action: ask
    approvals:
      max_ttl: "30m"
      max_calls: 3
`);

  const config = await loadConfig(cwd);
  assert.equal(config.tripwires.length, 1);
  assert.equal(config.tripwires[0].id, 'prod-db-delete');

  const decision = await evaluateOperation(config, {
    cwd,
    command: 'node scripts/run.js --fn deleteTenant',
    env: { DATABASE_URL: 'postgres://app@prod-db/main' }
  });

  assert.equal(decision.decision, 'ask');
  assert.equal(decision.matches[0].id, 'prod-db-delete');
  assert.equal(decision.matches[0].reasons[0].type, 'keyword');
});

test('does not match env-scoped tripwire when env condition is not met', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: live-stripe-charge
    match:
      keywords: ["chargeCustomer"]
    when:
      env:
        STRIPE_MODE: "live"
    action: ask
`);

  const config = await loadConfig(cwd);
  const decision = await evaluateOperation(config, {
    cwd,
    command: 'node -e "chargeCustomer()"',
    env: { STRIPE_MODE: 'test' }
  });

  assert.equal(decision.decision, 'allow');
  assert.equal(decision.matches.length, 0);
});

test('matches protected files and scanned file contents referenced by a command', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing-backfill
    match:
      keywords: ["chargeCustomer"]
      files: ["scripts/backfill/**"]
    action: ask
`);
  await writeProjectFile(cwd, 'scripts/backfill/payments.ts', 'export function main(){ chargeCustomer(); }');

  const config = await loadConfig(cwd);
  const decision = await evaluateOperation(config, {
    cwd,
    command: `node ${path.join(cwd, 'scripts/backfill/payments.ts')}`,
    env: {}
  });

  assert.equal(decision.decision, 'ask');
  assert.equal(decision.matches[0].id, 'billing-backfill');
  assert.ok(decision.matches[0].reasons.some((reason) => reason.type === 'file'));
  assert.ok(decision.matches[0].reasons.some((reason) => reason.type === 'keyword'));
});

test('detects destructive SQL built-ins and user SQL regexes', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: user-delete
    match:
      sql: ["DELETE\\\\s+FROM\\\\s+users"]
    action: ask
`);
  const config = await loadConfig(cwd);

  const builtin = scanSqlText('TRUNCATE TABLE invoices;');
  assert.equal(builtin.length, 1);
  assert.equal(builtin[0].id, 'builtin.sql.truncate');

  const decision = await evaluateOperation(config, {
    cwd,
    sql: 'DELETE FROM users WHERE id = 1',
    env: {}
  });
  assert.equal(decision.decision, 'ask');
  assert.equal(decision.matches[0].id, 'user-delete');
});
