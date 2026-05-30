import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { parseDuration } from './time.js';

const CONFIG_NAMES = ['.effectgate.yaml', '.effectgate.yml', 'effectgate.json'];

export async function findConfig(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(current, name);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function loadConfig(startDir = process.cwd()) {
  const configPath = await findConfig(startDir);
  if (!configPath) {
    return { configPath: null, rootDir: path.resolve(startDir), tripwires: [] };
  }

  const text = await readFile(configPath, 'utf8');
  const raw = configPath.endsWith('.json') ? JSON.parse(text) : YAML.parse(text);
  const rootDir = path.dirname(configPath);
  return normalizeConfig(raw || {}, configPath, rootDir);
}

export function normalizeConfig(raw, configPath = null, rootDir = process.cwd()) {
  const tripwires = Array.isArray(raw.tripwires) ? raw.tripwires.map((tripwire, index) => normalizeTripwire(tripwire, index)) : [];
  return { configPath, rootDir: path.resolve(rootDir), tripwires };
}

function normalizeTripwire(tripwire, index) {
  if (!tripwire || typeof tripwire !== 'object') {
    throw new Error(`Invalid tripwire at index ${index}: expected object`);
  }
  if (!tripwire.id || typeof tripwire.id !== 'string') {
    throw new Error(`Invalid tripwire at index ${index}: missing string id`);
  }
  const action = tripwire.action || 'ask';
  if (!['allow', 'ask', 'deny'].includes(action)) {
    throw new Error(`Invalid action for tripwire ${tripwire.id}: ${action}`);
  }

  const match = tripwire.match || {};
  const approvals = tripwire.approvals || {};
  return {
    id: tripwire.id,
    risk: tripwire.risk || null,
    action,
    match: {
      keywords: toStringArray(match.keywords),
      files: toStringArray(match.files),
      sql: toStringArray(match.sql),
      java: toStringArray(match.java)
    },
    when: {
      env: tripwire.when?.env && typeof tripwire.when.env === 'object' ? tripwire.when.env : {}
    },
    approvals: {
      maxTtlMs: parseDuration(approvals.max_ttl ?? approvals.maxTtl ?? '15m'),
      maxCalls: Number(approvals.max_calls ?? approvals.maxCalls ?? 1)
    }
  };
}

function toStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}
