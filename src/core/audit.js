import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDuration } from './time.js';

export async function appendAudit(cwd, entry) {
  const file = auditPath(cwd);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

export async function readAudit(cwd = process.cwd(), limit = 50) {
  try {
    const text = await readFile(auditPath(cwd), 'utf8');
    const rows = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return rows.slice(-limit);
  } catch {
    return [];
  }
}

export async function readRecentProtectedEffects(cwd = process.cwd(), { recent = '15m', limit = 200 } = {}) {
  const rows = await readAudit(cwd, limit);
  return summarizeRecentProtectedEffects(rows, { recent });
}

export function summarizeRecentProtectedEffects(rows, { recent = '15m', now = Date.now() } = {}) {
  const windowMs = parseDuration(recent, 15 * 60 * 1000);
  const cutoff = now - windowMs;
  const byEffect = new Map();
  for (const row of rows || []) {
    if (row.decision !== 'allow') continue;
    const time = Date.parse(row.time || '');
    if (!Number.isFinite(time) || time < cutoff) continue;
    for (const effectId of effectIdsForAuditRow(row)) {
      const current = byEffect.get(effectId);
      if (!current || time > Date.parse(current.lastSeenAt)) {
        byEffect.set(effectId, {
          effectId,
          lastSeenAt: row.time,
          approvalId: row.approvalId || null,
          kind: row.kind || null
        });
      }
    }
  }
  return [...byEffect.values()].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

function effectIdsForAuditRow(row) {
  const ids = new Set();
  if (row.effectId) ids.add(row.effectId);
  for (const match of row.matches || []) {
    if (match?.id) ids.add(match.id);
  }
  return [...ids];
}

export function auditPath(cwd = process.cwd()) {
  return path.join(path.resolve(cwd), '.effectgate', 'audit.jsonl');
}
