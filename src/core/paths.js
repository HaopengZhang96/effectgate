import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

export function adapterPath(name) {
  return path.join(repoRoot(), 'adapters', name, 'pre-tool-use.js');
}

export function codexPluginPath() {
  return path.join(repoRoot(), 'plugins', 'codex', 'effectgate');
}

export function desktopSourcePath() {
  return path.join(repoRoot(), 'desktop', 'macos', 'EffectGateMenuBar.swift');
}
