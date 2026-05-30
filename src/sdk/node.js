import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class EffectGateBlockedError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'EffectGateBlockedError';
    this.result = result;
  }
}

export function effect(effectId, fn) {
  if (typeof fn !== 'function') throw new TypeError('effect(effectId, fn) requires a function');
  return function guardedEffect(...args) {
    const result = checkEffectSync(effectId, args);
    if (!result.allowed) {
      throw new EffectGateBlockedError(result.stderr || `EffectGate blocked ${effectId}`, result);
    }
    return fn.apply(this, args);
  };
}

export function checkEffectSync(effectId, args = []) {
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/effectgate.js');
  const result = spawnSync(process.execPath, [cli, 'check', effectId, '--args-json', JSON.stringify(args)], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  return {
    allowed: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
