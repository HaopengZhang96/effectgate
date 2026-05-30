import { spawn } from 'node:child_process';
import { loadConfig } from './config.js';
import { evaluateOperation } from './matcher.js';
import { contextForApproval } from './context.js';
import { findApproval, consumeApproval } from './approval-store.js';
import { appendAudit } from './audit.js';
import { renderBlockCard } from './card.js';
import { createPending } from './pending-store.js';

export async function runCommand({ cwd = process.cwd(), commandArgs, env = process.env }) {
  if (!commandArgs?.length) throw new Error('No command provided. Use: effectgate run -- <command>');
  const commandText = commandArgs.join(' ');
  const config = await loadConfig(cwd);
  const evaluation = await evaluateOperation(config, { cwd, command: commandText, env });
  const context = await contextForApproval({ cwd, command: commandText });

  if (evaluation.decision !== 'allow') {
    const match = evaluation.matches[0];
    const approval = await findApproval({ cwd, effectId: match.id, context });
    if (!approval) {
      const pending = await createPending({
        cwd,
        kind: 'command',
        effectId: match.id,
        decision: evaluation.decision,
        command: commandText,
        matches: evaluation.matches,
        context
      });
      await appendAudit(cwd, {
        kind: 'command',
        decision: evaluation.decision,
        command: commandText,
        matches: evaluation.matches,
        context,
        pendingId: pending.id
      });
      process.stderr.write(renderBlockCard({
        command: commandText,
        matches: evaluation.matches,
        decision: evaluation.decision,
        context
      }));
      return evaluation.decision === 'deny' ? 43 : 42;
    }
    await consumeApproval({ cwd, approvalId: approval.id });
    await appendAudit(cwd, {
      kind: 'command',
      decision: 'allow',
      command: commandText,
      matches: evaluation.matches,
      approvalId: approval.id,
      context
    });
  }

  return spawnAndWait(commandArgs, cwd, env, context);
}

function spawnAndWait(commandArgs, cwd, env, context) {
  return new Promise((resolve) => {
    const child = spawn(commandArgs[0], commandArgs.slice(1), {
      cwd,
      stdio: 'inherit',
      env: {
        ...env,
        EFFECTGATE_ACTIVE: '1',
        EFFECTGATE_CWD: cwd,
        EFFECTGATE_GIT_SHA: context.gitSha || '',
        EFFECTGATE_ACTIVE_COMMAND_HASH: context.commandHash || ''
      }
    });
    child.on('exit', (code, signal) => {
      if (signal) resolve(128);
      else resolve(code ?? 1);
    });
    child.on('error', (error) => {
      process.stderr.write(`${error.message}\n`);
      resolve(1);
    });
  });
}
