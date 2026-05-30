import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function readHookInput() {
  const input = readFileSync(0, 'utf8').trim();
  return input ? JSON.parse(input) : {};
}

export function isBashTool(input) {
  const tool = input.tool_name || input.toolName || input.tool;
  return tool === 'Bash' || tool === 'shell' || tool === 'exec';
}

export function toolCommand(input) {
  return input.tool_input?.command || input.toolInput?.command || input.input?.command || null;
}

export function effectgateBin() {
  if (process.env.EFFECTGATE_BIN) return process.env.EFFECTGATE_BIN;
  return 'effectgate';
}

export function wrapCommand(command) {
  if (!command || /\beffectgate\s+run\s+--\b/.test(command)) return command;
  const bin = effectgateBin();
  if (bin.endsWith('.js') || bin.includes('/')) {
    return `${shellQuote(process.execPath)} ${shellQuote(bin)} run -- ${command}`;
  }
  return `${bin} run -- ${command}`;
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
