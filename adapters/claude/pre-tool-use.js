#!/usr/bin/env node
import { readHookInput, isBashTool, toolCommand, wrapCommand } from '../shared/hook-utils.js';

const input = readHookInput();
const command = toolCommand(input);

if (!isBashTool(input) || !command) {
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    permissionDecisionReason: 'EffectGate wrapped this Bash command so project tripwires can stop protected effects before execution.',
    updatedInput: {
      ...input.tool_input,
      command: wrapCommand(command)
    }
  }
}));
