const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const childProcess = require('node:child_process');

const originalJs = Module._extensions['.js'];

Module._extensions['.js'] = function effectgateRegister(module, filename) {
  if (!filename.includes('node_modules')) {
    const result = childProcess.spawnSync(process.execPath, [effectgateBin(), 'scan-file', filename], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });
    if (result.status === 42 || result.status === 43 || /EffectGate blocked/.test(result.stderr || result.stdout)) {
      throw new Error(result.stderr || result.stdout || `EffectGate blocked loading ${filename}`);
    }
  }
  return originalJs(module, filename);
};

function effectgateBin() {
  return process.env.EFFECTGATE_BIN || path.resolve(__dirname, '../../bin/effectgate.js');
}
