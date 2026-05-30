import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.startsWith('file:') || !['module', 'commonjs'].includes(result.format)) {
    return result;
  }
  const filename = fileURLToPath(url);
  if (filename.includes('node_modules')) return result;
  if (!result.source) await readFile(filename, 'utf8');
  const check = spawnSync(process.execPath, [effectgateBin(), 'scan-file', filename], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  if (check.status === 42 || check.status === 43) {
    throw new Error(check.stderr || check.stdout || `EffectGate blocked loading ${filename}`);
  }
  return result;
}

function effectgateBin() {
  return process.env.EFFECTGATE_BIN || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/effectgate.js');
}
