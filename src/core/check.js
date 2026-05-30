import { loadConfig } from './config.js';
import { findApproval, consumeApproval } from './approval-store.js';
import { contextForApproval } from './context.js';
import { appendAudit } from './audit.js';
import { renderBlockCard } from './card.js';
import { createPending } from './pending-store.js';

export async function checkRuntimeEffect({ cwd = process.cwd(), effectId, argsHash, command, consume = true }) {
  const config = await loadConfig(cwd);
  const tripwire = config.tripwires.find((item) => item.id === effectId);
  if (!tripwire) {
    return { decision: 'allow', matches: [] };
  }
  const context = await contextForApproval({ cwd, command, argsHash });
  const approval = await findApproval({ cwd, effectId, context });
  if (approval) {
    if (consume) await consumeApproval({ cwd, approvalId: approval.id });
    await appendAudit(cwd, {
      kind: 'runtime',
      decision: 'allow',
      effectId,
      approvalId: approval.id,
      context
    });
    return { decision: 'allow', approval, matches: [{ id: effectId, action: 'allow', reasons: [{ type: 'approval', value: approval.id }] }] };
  }
  const decision = tripwire.action === 'deny' ? 'deny' : 'ask';
  const matches = [{ id: effectId, risk: tripwire.risk, action: tripwire.action, reasons: [{ type: 'runtime_effect', value: effectId }] }];
  const pending = await createPending({ cwd, kind: 'runtime', effectId, decision, matches, context });
  await appendAudit(cwd, {
    kind: 'runtime',
    decision,
    effectId,
    matches,
    context,
    pendingId: pending.id
  });
  return {
    decision,
    matches,
    card: renderBlockCard({ effectId, matches, decision, context })
  };
}
