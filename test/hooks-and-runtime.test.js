import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempProject, writeProjectFile } from './helpers.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, 'bin/effectgate.js');
const claudeHook = path.join(repoRoot, 'adapters/claude/pre-tool-use.js');
const codexHook = path.join(repoRoot, 'adapters/codex/pre-tool-use.js');

test('claude hook wraps Bash commands with effectgate run', () => {
  const input = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm run backfill-prod' }
  });

  const result = spawnSync(process.execPath, [claudeHook], {
    input,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(output.hookSpecificOutput.updatedInput.command, /effectgate run --/);
  assert.match(output.hookSpecificOutput.updatedInput.command, /npm run backfill-prod/);
});

test('codex hook wraps Bash commands with effectgate run using Codex output shape', () => {
  const input = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'python scripts/prod.py' }
  });

  const result = spawnSync(process.execPath, [codexHook], {
    input,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(output.hookSpecificOutput.updatedInput.command, /effectgate run --/);
});

test('python decorator blocks a protected effect until an approval exists', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    match:
      keywords: ["charge_customer"]
    action: ask
`);
  const script = await writeProjectFile(cwd, 'charge.py', `
from effectgate import effect

@effect("billing.charge")
def charge_customer(customer):
    print("charged", customer)

charge_customer("cus_123")
`);

  const blocked = spawnSync('python3', [script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: path.join(repoRoot, 'python'), EFFECTGATE_BIN: cli }
  });
  assert.equal(blocked.status, 42);
  assert.match(blocked.stderr, /billing\.charge/);

  const approve = spawnSync(process.execPath, [cli, 'approve', 'billing.charge', '--ttl', '10m', '--max-calls', '1', '--scope', 'session'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(approve.status, 0);

  const allowed = spawnSync('python3', [script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: path.join(repoRoot, 'python'), EFFECTGATE_BIN: cli }
  });
  assert.equal(allowed.status, 0);
  assert.match(allowed.stdout, /charged cus_123/);
});

test('scan-java reports configured Java keyword matches', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: java-prod-delete
    match:
      java: ["deleteTenant"]
    action: ask
`);
  await writeProjectFile(cwd, 'src/main/java/AdminOps.java', 'class AdminOps { void deleteTenant() {} }');

  const result = spawnSync(process.execPath, [cli, 'scan-java', 'src/main/java/AdminOps.java'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 42);
  assert.match(result.stdout, /java-prod-delete/);
});
