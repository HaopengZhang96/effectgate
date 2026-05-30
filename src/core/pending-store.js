import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalCwd } from './context.js';

export async function createPending({ cwd = process.cwd(), kind, effectId, decision, command, matches = [], context = {} }) {
  const entries = await readPending(cwd, { includeResolved: true });
  const openDuplicate = entries.find((entry) => (
    entry.status === 'pending'
    && entry.effectId === effectId
    && entry.context?.argsHash === context.argsHash
    && entry.context?.commandHash === context.commandHash
  ));
  if (openDuplicate) return openDuplicate;

  const entry = {
    id: crypto.randomUUID(),
    status: 'pending',
    cwd: canonicalCwd(cwd),
    kind,
    effectId,
    decision,
    command: command || null,
    matches,
    context,
    createdAt: new Date().toISOString()
  };
  entries.push(entry);
  await writePending(cwd, entries);
  return entry;
}

export async function readPending(cwd = process.cwd(), options = {}) {
  const includeResolved = Boolean(options.includeResolved);
  try {
    const rows = JSON.parse(await readFile(pendingPath(cwd), 'utf8'));
    return includeResolved ? rows : rows.filter((entry) => entry.status === 'pending');
  } catch {
    return [];
  }
}

export async function resolvePendingByEffect({ cwd = process.cwd(), effectId, status = 'approved' }) {
  const entries = await readPending(cwd, { includeResolved: true });
  let changed = false;
  const now = new Date().toISOString();
  const updated = entries.map((entry) => {
    if (entry.status !== 'pending' || entry.effectId !== effectId) return entry;
    changed = true;
    return { ...entry, status, resolvedAt: now };
  });
  if (changed) await writePending(cwd, updated);
  return changed;
}

export async function resolvePendingById({ cwd = process.cwd(), id, status = 'denied' }) {
  const entries = await readPending(cwd, { includeResolved: true });
  let found = false;
  const now = new Date().toISOString();
  const updated = entries.map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return { ...entry, status, resolvedAt: now };
  });
  if (!found) return null;
  await writePending(cwd, updated);
  return updated.find((entry) => entry.id === id);
}

export function renderBarStatus(pending, { recent = [] } = {}) {
  if (!pending.length && recent.length) {
    const labels = recent.slice(0, 3).map((entry) => entry.effectId).join(', ');
    const suffix = recent.length > 3 ? ` +${recent.length - 3} more` : '';
    return `EffectGate: ${recent.length} recent - ${labels}${suffix}`;
  }
  if (!pending.length) return 'EffectGate: no pending effects';
  const labels = pending.slice(0, 3).map((entry) => entry.effectId).join(', ');
  const suffix = pending.length > 3 ? ` +${pending.length - 3} more` : '';
  return `EffectGate: ${pending.length} pending - ${labels}${suffix}`;
}

async function writePending(cwd, entries) {
  await mkdir(path.dirname(pendingPath(cwd)), { recursive: true });
  await writeFile(pendingPath(cwd), `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

export function pendingPath(cwd = process.cwd()) {
  return path.join(canonicalCwd(cwd), '.effectgate', 'pending.json');
}
