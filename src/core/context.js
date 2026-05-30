import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashString(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function hashArgs(args) {
  return hashString(stableJson(args)).slice(0, 24);
}

export function commandHash(command) {
  if (!command) return null;
  return hashString(command).slice(0, 24);
}

export function currentGitSha(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

export async function contextForApproval({ cwd = process.cwd(), command, script, argsHash } = {}) {
  const resolvedCwd = canonicalCwd(cwd);
  return {
    cwd: resolvedCwd,
    gitSha: currentGitSha(resolvedCwd),
    commandHash: commandHash(command),
    script: script ? path.resolve(resolvedCwd, script) : null,
    argsHash: argsHash || null
  };
}

export function canonicalCwd(cwd = process.cwd()) {
  const resolved = path.resolve(cwd);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}
