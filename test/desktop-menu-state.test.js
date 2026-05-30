import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourcePath = path.join(repoRoot, 'desktop/macos/EffectGateMenuBar.swift');

test('desktop menu treats daemon offline as status, not as a pending protected effect', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /enum\s+SummaryLoadResult/);
  assert.match(source, /case\s+offline/);
  assert.doesNotMatch(source, /PendingAlert\(id:\s*"",\s*effectId:\s*"Daemon offline"/);
  assert.match(source, /No approval actions when the daemon is offline/);
});

test('desktop menu shows recent protected effects without approval actions', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /Recent protected effects/);
  assert.match(source, /recently used/);
  assert.match(source, /effectGateSummaryURL/);
});
