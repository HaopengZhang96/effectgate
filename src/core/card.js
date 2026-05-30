export function renderBlockCard({ command, effectId, matches, approval, decision = 'ask', context = {} }) {
  const first = matches?.[0] || { id: effectId, reasons: [] };
  const lines = [
    '',
    'EffectGate blocked a protected effect',
    '',
    `Decision: ${decision.toUpperCase()}`,
    `Tripwire: ${first.id}`,
    first.risk ? `Risk: ${first.risk}` : null,
    command ? `Command: ${command}` : null,
    context.gitSha ? `Git SHA: ${context.gitSha}` : null,
    context.argsHash ? `Args hash: ${context.argsHash}` : null,
    '',
    'Matched evidence:'
  ].filter(Boolean);

  for (const match of matches || []) {
    for (const reason of match.reasons || []) {
      lines.push(`- ${match.id}: ${reason.type} ${reason.value || reason.pattern || ''}`.trim());
    }
  }
  if (!matches?.length) lines.push(`- exact runtime effect ${effectId}`);

  lines.push('', 'Approve narrowly:');
  lines.push(`- effectgate approve ${first.id} --ttl 10m --max-calls 1 --scope session`);
  if (command) lines.push(`- effectgate approve ${first.id} --ttl 10m --max-calls 1 --scope command --command ${JSON.stringify(command)}`);
  if (approval) lines.push(`- Existing approval ${approval.id} was not applicable`);
  lines.push('');
  return lines.join('\n');
}
