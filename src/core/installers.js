import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { adapterPath, codexPluginPath, desktopSourcePath, repoRoot } from './paths.js';

const execFileAsync = promisify(execFile);

export async function installClaude({ cwd = process.cwd(), dryRun = false } = {}) {
  const settingsPath = path.join(cwd, '.claude', 'settings.local.json');
  const command = `node ${JSON.stringify(adapterPath('claude'))}`;
  const next = mergeClaudeSettings(await readJson(settingsPath), command);
  if (!dryRun) {
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }
  return {
    settingsPath,
    command,
    message: dryRun
      ? `Would install Claude Code hook in ${settingsPath}`
      : `Installed Claude Code hook in ${settingsPath}`
  };
}

export async function installCodex({ dryRun = false } = {}) {
  const source = codexPluginPath();
  return {
    source,
    message: `${dryRun ? 'Codex plugin source' : 'Codex plugin source'}: ${source}\nInstall it from the Codex app or copy this plugin directory into your Codex plugin marketplace.`
  };
}

export async function installCliBar({ cwd = process.cwd(), dryRun = false } = {}) {
  const stateDir = path.join(cwd, '.effectgate');
  const scriptPath = path.join(stateDir, 'effectgate-bar.sh');
  const args = effectgateProgramArguments();
  const script = `#!/bin/sh
cd ${shellQuote(path.resolve(cwd))}
exec ${args.map(shellQuote).join(' ')} bar --once --recent "\${EFFECTGATE_RECENT_WINDOW:-24h}" "$@"
`;
  if (!dryRun) {
    await mkdir(stateDir, { recursive: true });
    await writeFile(scriptPath, script, 'utf8');
    await chmod(scriptPath, 0o755);
  }
  return {
    scriptPath,
    message: dryRun
      ? `Would install CLI bar helper at ${scriptPath}`
      : `Installed CLI bar helper at ${scriptPath}`
  };
}

export async function installDesktop({
  cwd = process.cwd(),
  dryRun = false,
  home = process.env.HOME || process.cwd(),
  outDir = path.join(home, '.effectgate'),
  start = false,
  port
} = {}) {
  const source = desktopSourcePath();
  const binary = path.join(outDir, 'EffectGateMenuBar');
  const command = ['swiftc', source, '-o', binary, '-framework', 'Cocoa', '-framework', 'Foundation'];
  const launchAgentsDir = path.join(home, 'Library', 'LaunchAgents');
  const projectHash = Buffer.from(path.resolve(cwd)).toString('hex').slice(0, 16);
  const daemonPort = Number(port || desktopPortForProject(projectHash));
  const daemonUrl = `http://127.0.0.1:${daemonPort}`;
  const daemonLabel = `dev.effectgate.${projectHash}.daemon`;
  const barLabel = `dev.effectgate.${projectHash}.bar`;
  const daemonPlist = path.join(launchAgentsDir, `${daemonLabel}.plist`);
  const barPlist = path.join(launchAgentsDir, `${barLabel}.plist`);
  const startScript = path.join(outDir, 'start-effectgate-desktop.sh');
  const cliArgs = effectgateProgramArguments();
  if (!dryRun) {
    await mkdir(outDir, { recursive: true });
    await mkdir(launchAgentsDir, { recursive: true });
    await execFileAsync(command[0], command.slice(1));
    await writeFile(daemonPlist, launchAgentPlist({
      label: daemonLabel,
      programArguments: [...cliArgs, 'daemon', '--port', String(daemonPort)],
      workingDirectory: path.resolve(cwd),
      logPrefix: path.join(outDir, daemonLabel)
    }), 'utf8');
    await writeFile(barPlist, launchAgentPlist({
      label: barLabel,
      programArguments: [binary],
      workingDirectory: path.resolve(cwd),
      logPrefix: path.join(outDir, barLabel),
      environment: {
        EFFECTGATE_DAEMON_URL: daemonUrl
      }
    }), 'utf8');
    await writeFile(startScript, launchScript({ daemonPlist, barPlist }), 'utf8');
    await chmod(startScript, 0o755);
    if (start) {
      await execFileAsync(startScript, []);
    }
  }
  return {
    source,
    binary,
    command,
    daemonPlist,
    barPlist,
    startScript,
    message: [
      `${dryRun ? 'Would build' : 'Built'} macOS bar: ${command.join(' ')}`,
      `${dryRun ? 'Would write' : 'Wrote'} LaunchAgents: ${daemonPlist} and ${barPlist}`,
      `Daemon LaunchAgent runs: effectgate daemon --port ${daemonPort}`,
      `Menu bar daemon URL: ${daemonUrl}`,
      `${dryRun ? 'Would write' : 'Wrote'} helper script: ${startScript}`,
      'Start it with: ~/.effectgate/start-effectgate-desktop.sh',
      start ? 'Desktop bar was started with launchctl.' : 'Use --start to load the LaunchAgents immediately.'
    ].join('\n')
  };
}

export async function doctorReport({ cwd = process.cwd() } = {}) {
  const { loadConfig } = await import('./config.js');
  const { readPending } = await import('./pending-store.js');
  const config = await loadConfig(cwd);
  return {
    config: {
      found: Boolean(config.configPath),
      path: config.configPath
    },
    tripwires: config.tripwires.length,
    pending: (await readPending(cwd)).length,
    surfaces: {
      cli: existsSync(path.join(path.dirname(adapterPath('claude')), '../../bin/effectgate.js')),
      nodeSdk: existsSync(path.join(path.dirname(adapterPath('claude')), '../../src/sdk/node.js')),
      pythonPackage: existsSync(path.join(path.dirname(adapterPath('claude')), '../../python/effectgate/__init__.py')),
      claudeAdapter: existsSync(adapterPath('claude')),
      codexAdapter: existsSync(adapterPath('codex')),
      codexPlugin: existsSync(codexPluginPath()),
      desktopBarSource: existsSync(desktopSourcePath())
    }
  };
}

function mergeClaudeSettings(current, command) {
  const settings = current || {};
  settings.hooks ||= {};
  settings.hooks.PreToolUse ||= [];
  const entry = {
    matcher: 'Bash',
    hooks: [{ type: 'command', command }]
  };
  const alreadyInstalled = settings.hooks.PreToolUse.some((item) => (
    item?.matcher === 'Bash'
    && Array.isArray(item.hooks)
    && item.hooks.some((hook) => hook.command === command)
  ));
  if (!alreadyInstalled) settings.hooks.PreToolUse.push(entry);
  return settings;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function effectgateProgramArguments() {
  return [process.execPath, path.join(repoRoot(), 'bin', 'effectgate.js')];
}

function launchAgentPlist({ label, programArguments, workingDirectory, logPrefix, environment = null }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
${environment ? environmentPlist(environment) : ''}
  <key>ProgramArguments</key>
  <array>
${programArguments.map((arg) => `    <string>${escapeXml(arg)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(`${logPrefix}.out.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(`${logPrefix}.err.log`)}</string>
</dict>
</plist>
`;
}

function environmentPlist(environment) {
  const rows = Object.entries(environment).map(([key, value]) => (
    `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`
  )).join('\n');
  return `  <key>EnvironmentVariables</key>
  <dict>
${rows}
  </dict>
`;
}

function desktopPortForProject(projectHash) {
  return 8765 + (Number.parseInt(projectHash.slice(0, 4), 16) % 1000);
}

function launchScript({ daemonPlist, barPlist }) {
  return `#!/bin/sh
set -eu
launchctl bootstrap "gui/$(id -u)" "${daemonPlist}" 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/$(basename "${daemonPlist}" .plist)"
launchctl bootstrap "gui/$(id -u)" "${barPlist}" 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/$(basename "${barPlist}" .plist)"
echo "EffectGate desktop bar is starting."
`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
