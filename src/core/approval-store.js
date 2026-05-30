import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseDuration } from './time.js';
import { canonicalCwd } from './context.js';

export async function createApproval({ cwd = process.cwd(), effectId, ttl = '10m', maxCalls = 1, scope = 'session', context = {} }) {
  if (!effectId) throw new Error('effectId is required');
  const approvals = await readApprovals(cwd);
  const now = Date.now();
  const token = {
    id: crypto.randomUUID(),
    effectId,
    scope,
    cwd: canonicalCwd(cwd),
    gitSha: context.gitSha || null,
    commandHash: scope === 'command' ? context.commandHash || null : null,
    script: scope === 'script' ? context.script || null : null,
    argsHash: context.argsHash || null,
    expiresAt: new Date(now + parseDuration(ttl)).toISOString(),
    maxCalls: Number(maxCalls),
    callsUsed: 0,
    createdAt: new Date(now).toISOString()
  };
  approvals.push(token);
  await writeApprovals(cwd, approvals);
  return token;
}

export async function findApproval({ cwd = process.cwd(), effectId, context = {} }) {
  const approvals = await readApprovals(cwd);
  const now = Date.now();
  return approvals.find((approval) => {
    if (approval.effectId !== effectId) return false;
    if (canonicalCwd(approval.cwd) !== canonicalCwd(cwd)) return false;
    if (Date.parse(approval.expiresAt) <= now) return false;
    if (approval.callsUsed >= approval.maxCalls) return false;
    if (approval.gitSha && context.gitSha && approval.gitSha !== context.gitSha) return false;
    if (approval.commandHash && approval.commandHash !== context.commandHash) return false;
    if (approval.script && approval.script !== context.script) return false;
    if (approval.argsHash && approval.argsHash !== context.argsHash) return false;
    return true;
  }) || null;
}

export async function consumeApproval({ cwd = process.cwd(), approvalId }) {
  const approvals = await readApprovals(cwd);
  const updated = approvals.map((approval) => {
    if (approval.id !== approvalId) return approval;
    return { ...approval, callsUsed: approval.callsUsed + 1, lastUsedAt: new Date().toISOString() };
  });
  await writeApprovals(cwd, updated);
}

export async function listApprovals(cwd = process.cwd()) {
  return readApprovals(cwd);
}

export async function readApprovals(cwd = process.cwd()) {
  try {
    return JSON.parse(await readFile(approvalsPath(cwd), 'utf8'));
  } catch {
    return [];
  }
}

async function writeApprovals(cwd, approvals) {
  await mkdir(stateDir(cwd), { recursive: true });
  await writeFile(approvalsPath(cwd), `${JSON.stringify(approvals, null, 2)}\n`, 'utf8');
}

export function stateDir(cwd = process.cwd()) {
  return path.join(canonicalCwd(cwd), '.effectgate');
}

export function approvalsPath(cwd = process.cwd()) {
  return path.join(stateDir(cwd), 'approvals.json');
}
