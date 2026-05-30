import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, stat } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempProject } from './helpers.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repoRoot, 'bin/effectgate.js');

test('effectgate demo creates a runnable demo project with a pending protected-effect alert', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'effectgate-demo-parent-'));
  const result = spawnSync(process.execPath, [cli, 'demo', '--dir', parent], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /EffectGate demo is ready/);
  assert.match(result.stdout, /EffectGate: 1 pending - billing\.charge/);

  const demoDir = path.join(parent, 'effectgate-demo');
  await stat(path.join(demoDir, '.effectgate.yaml'));

  const pending = spawnSync(process.execPath, [cli, 'pending', '--json'], {
    cwd: demoDir,
    encoding: 'utf8'
  });
  assert.equal(pending.status, 0);
  const pendingJson = JSON.parse(pending.stdout);
  assert.equal(pendingJson.pending.length, 1);
  assert.equal(pendingJson.pending[0].effectId, 'billing.charge');
});

test('desktop install writes launch-agent plists and helper script for the current repo without starting them by default', async () => {
  const cwd = await makeTempProject('');
  const home = await mkdtemp(path.join(tmpdir(), 'effectgate-home-'));

  const result = spawnSync(process.execPath, [cli, 'install', 'desktop', '--home', home], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Built macOS bar/);
  assert.match(result.stdout, /LaunchAgents/);

  const projectHash = Buffer.from(await realpath(cwd)).toString('hex').slice(0, 16);
  const daemonPlist = path.join(home, 'Library/LaunchAgents', `dev.effectgate.${projectHash}.daemon.plist`);
  const barPlist = path.join(home, 'Library/LaunchAgents', `dev.effectgate.${projectHash}.bar.plist`);
  const startScript = path.join(home, '.effectgate', 'start-effectgate-desktop.sh');

  const daemonText = await readFile(daemonPlist, 'utf8');
  const barText = await readFile(barPlist, 'utf8');
  const scriptText = await readFile(startScript, 'utf8');

  assert.match(daemonText, /effectgate/);
  assert.match(daemonText, /daemon/);
  assert.match(daemonText, new RegExp(escapeRegExp(cwd)));
  const portMatch = daemonText.match(/<string>--port<\/string>\s*<string>(\d+)<\/string>/);
  assert.ok(portMatch, 'daemon LaunchAgent should include an explicit port');
  const daemonPort = Number(portMatch[1]);
  assert.ok(daemonPort >= 8765 && daemonPort <= 9764);
  assert.match(barText, /EffectGateMenuBar/);
  assert.match(barText, new RegExp(`<key>EFFECTGATE_DAEMON_URL</key>\\s*<string>http://127\\.0\\.0\\.1:${daemonPort}</string>`));
  assert.match(scriptText, /launchctl bootstrap/);
});

test('desktop install accepts an explicit port and wires the menu bar to that daemon URL', async () => {
  const cwd = await makeTempProject('');
  const home = await mkdtemp(path.join(tmpdir(), 'effectgate-home-'));

  const result = spawnSync(process.execPath, [cli, 'install', 'desktop', '--home', home, '--port', '9555'], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /http:\/\/127\.0\.0\.1:9555/);

  const projectHash = Buffer.from(await realpath(cwd)).toString('hex').slice(0, 16);
  const daemonPlist = path.join(home, 'Library/LaunchAgents', `dev.effectgate.${projectHash}.daemon.plist`);
  const barPlist = path.join(home, 'Library/LaunchAgents', `dev.effectgate.${projectHash}.bar.plist`);

  const daemonText = await readFile(daemonPlist, 'utf8');
  const barText = await readFile(barPlist, 'utf8');

  assert.match(daemonText, /<string>--port<\/string>\s*<string>9555<\/string>/);
  assert.match(barText, /<key>EFFECTGATE_DAEMON_URL<\/key>\s*<string>http:\/\/127\.0\.0\.1:9555<\/string>/);
});

test('setup can register a protected effect and install desktop support in one command', async () => {
  const cwd = await makeTempProject('');
  const home = await mkdtemp(path.join(tmpdir(), 'effectgate-home-'));

  const setup = spawnSync(process.execPath, [
    cli,
    'setup',
    '--protect',
    'billing.charge',
    '--keyword',
    'chargeCustomer',
    '--risk',
    'money_movement',
    '--desktop',
    '--home',
    home,
    '--port',
    '9555'
  ], {
    cwd,
    encoding: 'utf8'
  });

  assert.equal(setup.status, 0, setup.stderr);
  assert.match(setup.stdout, /Protected billing\.charge/);
  assert.match(setup.stdout, /Menu bar daemon URL: http:\/\/127\.0\.0\.1:9555/);
  assert.match(setup.stdout, /verify-install billing\.charge --surface desktop/);

  const verified = spawnSync(process.execPath, [cli, 'verify-install', 'billing.charge', '--surface', 'desktop', '--home', home, '--json'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(verified.status, 0, verified.stderr);
  const body = JSON.parse(verified.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.checks.surfaces.desktop.daemonUrl, 'http://127.0.0.1:9555');
  assert.equal(body.checks.surfaces.desktop.selfTest.ok, true);
  assert.match(body.checks.surfaces.desktop.selfTest.stdout, /billing\.charge/);
});

test('compiled desktop menu bar self-test reads pending effects from the daemon URL', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    risk: money_movement
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);
  const outDir = await mkdtemp(path.join(tmpdir(), 'effectgate-desktop-build-'));
  const binary = path.join(outDir, 'EffectGateMenuBar');
  const compile = spawnSync('swiftc', [
    path.join(repoRoot, 'desktop/macos/EffectGateMenuBar.swift'),
    '-o',
    binary,
    '-framework',
    'Cocoa',
    '-framework',
    'Foundation'
  ], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);

  const alert = spawnSync(process.execPath, [cli, 'test-alert', 'billing.charge'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(alert.status, 0, alert.stderr);

  const port = await freePort();
  const daemon = await startDaemonProcess({ cwd, port });
  try {
    const result = spawnSync(binary, [], {
      env: {
        ...process.env,
        EFFECTGATE_SELF_TEST: '1',
        EFFECTGATE_DAEMON_URL: `http://127.0.0.1:${port}`
      },
      encoding: 'utf8',
      timeout: 5000
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /billing\.charge/);
    assert.match(result.stdout, /pendingCount=1/);
  } finally {
    daemon.kill('SIGTERM');
    await new Promise((resolve) => daemon.once('exit', resolve));
  }
});

test('compiled desktop menu bar self-test reports recently executed protected effects', async () => {
  const cwd = await makeTempProject(`
tripwires:
  - id: billing.charge
    risk: money_movement
    match:
      keywords: ["chargeCustomer"]
    action: ask
`);
  const outDir = await mkdtemp(path.join(tmpdir(), 'effectgate-desktop-build-'));
  const binary = path.join(outDir, 'EffectGateMenuBar');
  const compile = spawnSync('swiftc', [
    path.join(repoRoot, 'desktop/macos/EffectGateMenuBar.swift'),
    '-o',
    binary,
    '-framework',
    'Cocoa',
    '-framework',
    'Foundation'
  ], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);

  const approve = spawnSync(process.execPath, [cli, 'approve', 'billing.charge', '--ttl', '10m', '--max-calls', '1', '--scope', 'session'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(approve.status, 0, approve.stderr);
  const allowed = spawnSync(process.execPath, [cli, 'check', 'billing.charge', '--args-json', '["cus_recent"]'], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(allowed.status, 0, allowed.stderr);

  const port = await freePort();
  const daemon = await startDaemonProcess({ cwd, port });
  try {
    const result = spawnSync(binary, [], {
      env: {
        ...process.env,
        EFFECTGATE_SELF_TEST: '1',
        EFFECTGATE_DAEMON_URL: `http://127.0.0.1:${port}`
      },
      encoding: 'utf8',
      timeout: 5000
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /recentCount=1/);
    assert.match(result.stdout, /recentEffects=billing\.charge/);
  } finally {
    daemon.kill('SIGTERM');
    await new Promise((resolve) => daemon.once('exit', resolve));
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function startDaemonProcess({ cwd, port }) {
  const child = spawn(process.execPath, [cli, 'daemon', '--port', String(port)], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`daemon did not start\n${stdout}\n${stderr}`));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.includes(`http://127.0.0.1:${port}`)) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`daemon exited with ${code}\n${stdout}\n${stderr}`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
