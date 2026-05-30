import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTempProject } from './helpers.js';
import { effect, EffectGateBlockedError } from '../src/sdk/node.js';
import { createApproval } from '../src/core/approval-store.js';
import { contextForApproval, hashArgs } from '../src/core/context.js';

test('node sdk blocks protected effect without approval and allows with scoped token', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    const guarded = effect('billing.charge', (customerId) => `charged ${customerId}`);

    assert.throws(() => guarded('cus_123'), EffectGateBlockedError);

    const argsHash = hashArgs(['cus_123']);
    const context = await contextForApproval({ cwd, argsHash });
    await createApproval({
      cwd,
      effectId: 'billing.charge',
      ttl: '10m',
      maxCalls: 1,
      scope: 'session',
      context
    });

    assert.equal(guarded('cus_123'), 'charged cus_123');
  } finally {
    process.chdir(previousCwd);
  }
});
