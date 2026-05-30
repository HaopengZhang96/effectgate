import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTempProject } from './helpers.js';
import { createApproval, findApproval, consumeApproval, listApprovals } from '../src/core/approval-store.js';
import { contextForApproval } from '../src/core/context.js';

test('approval token is scoped by effect, cwd, command hash, ttl, and max calls', async () => {
  const cwd = await makeTempProject('');
  const context = await contextForApproval({
    cwd,
    command: 'npm run backfill-prod',
    argsHash: 'args-1'
  });

  const approval = await createApproval({
    cwd,
    effectId: 'billing-charge',
    ttl: '10m',
    maxCalls: 1,
    scope: 'command',
    context
  });

  assert.equal(approval.effectId, 'billing-charge');

  const found = await findApproval({
    cwd,
    effectId: 'billing-charge',
    context
  });
  assert.equal(found?.id, approval.id);

  await consumeApproval({ cwd, approvalId: approval.id });

  const afterUse = await findApproval({
    cwd,
    effectId: 'billing-charge',
    context
  });
  assert.equal(afterUse, null);

  const approvals = await listApprovals(cwd);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].callsUsed, 1);
});

test('expired approval and command hash mismatch are not accepted', async () => {
  const cwd = await makeTempProject('');
  const context = await contextForApproval({
    cwd,
    command: 'npm run one',
    argsHash: 'same'
  });

  await createApproval({
    cwd,
    effectId: 'danger',
    ttl: '-1s',
    maxCalls: 3,
    scope: 'session',
    context
  });

  assert.equal(await findApproval({ cwd, effectId: 'danger', context }), null);

  await createApproval({
    cwd,
    effectId: 'danger',
    ttl: '10m',
    maxCalls: 3,
    scope: 'command',
    context
  });

  const mismatched = await contextForApproval({
    cwd,
    command: 'npm run two',
    argsHash: 'same'
  });

  assert.equal(await findApproval({ cwd, effectId: 'danger', context: mismatched }), null);
});
