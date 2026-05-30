import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { runCommand } from './core/run.js';
import { createApproval, listApprovals } from './core/approval-store.js';
import { contextForApproval, hashArgs } from './core/context.js';
import { appendAudit, readAudit, readRecentProtectedEffects } from './core/audit.js';
import { checkRuntimeEffect } from './core/check.js';
import { loadConfig } from './core/config.js';
import { listWritableTripwires, protectTripwire } from './core/config-writer.js';
import { evaluateOperation, scanSqlText } from './core/matcher.js';
import { startDaemon } from './daemon/server.js';
import { createPending, readPending, renderBarStatus, resolvePendingByEffect, resolvePendingById } from './core/pending-store.js';
import { doctorReport, installClaude, installCliBar, installCodex, installDesktop } from './core/installers.js';
import { repoRoot } from './core/paths.js';

export async function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'init':
      return initCommand(rest);
    case 'run':
      return runCli(rest);
    case 'approve':
      return approveCli(rest);
    case 'status':
      return statusCli();
    case 'pending':
      return pendingCli(rest);
    case 'deny':
      return denyCli(rest);
    case 'bar':
      return barCli(rest);
    case 'audit':
      return auditCli(rest);
    case 'protect':
      return protectCli(rest);
    case 'list':
      return listCli(rest);
    case 'test-alert':
      return testAlertCli(rest);
    case 'verify-install':
      return verifyInstallCli(rest);
    case 'check':
      return checkCli(rest);
    case 'check-keyword':
      return checkKeywordCli(rest);
    case 'scan-sql':
      return scanSqlCli(rest);
    case 'scan-java':
      return scanJavaCli(rest);
    case 'scan-file':
      return scanFileCli(rest);
    case 'daemon':
      return daemonCli(rest);
    case 'install':
      return installCli(rest);
    case 'doctor':
      return doctorCli(rest);
    case 'demo':
      return demoCli(rest);
    case 'setup':
      return setupCli(rest);
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      return 0;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      return 1;
  }
}

async function initCommand() {
  const created = await ensureDefaultConfig({ cwd: process.cwd(), overwrite: false });
  console.log(created ? 'Created .effectgate.yaml' : '.effectgate.yaml already exists');
  return 0;
}

async function ensureDefaultConfig({ cwd = process.cwd(), overwrite = false } = {}) {
  const targetConfig = path.join(cwd, '.effectgate.yaml');
  if (!overwrite) {
    try {
      await access(targetConfig);
      return false;
    } catch {
      // create below
    }
  }
  const stateDir = path.join(cwd, '.effectgate');
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx' }).catch(() => {});
  await writeFile(targetConfig, `tripwires:
  - id: prod-db-delete
    risk: irreversible_data_delete
    match:
      keywords: ["deleteTenant", "dropUserData"]
      sql: ["DELETE\\\\s+FROM\\\\s+users", "DROP\\\\s+TABLE"]
    when:
      env:
        DATABASE_URL: "*prod*"
    action: ask
    approvals:
      max_ttl: "30m"
      max_calls: 1
`, 'utf8');
  return true;
}

async function runCli(args) {
  const separator = args.indexOf('--');
  const commandArgs = separator >= 0 ? args.slice(separator + 1) : args;
  return runCommand({ cwd: process.cwd(), commandArgs });
}

async function approveCli(args) {
  const effectId = args[0];
  if (!effectId) throw new Error('Usage: effectgate approve <effect-id> [--ttl 10m] [--max-calls 1] [--scope session|command|script]');
  const flags = parseFlags(args.slice(1));
  const context = await contextForApproval({
    cwd: process.cwd(),
    command: flags.command,
    script: flags.script,
    argsHash: flags['args-hash']
  });
  const approval = await createApproval({
    cwd: process.cwd(),
    effectId,
    ttl: flags.ttl || '10m',
    maxCalls: Number(flags['max-calls'] || 1),
    scope: flags.scope || 'session',
    context
  });
  await resolvePendingByEffect({ cwd: process.cwd(), effectId, status: 'approved' });
  console.log(JSON.stringify(approval, null, 2));
  return 0;
}

async function statusCli() {
  const approvals = await listApprovals(process.cwd());
  const pending = await readPending(process.cwd());
  console.log(JSON.stringify({ approvals, pending }, null, 2));
  return 0;
}

async function pendingCli(args) {
  const flags = parseFlags(args);
  const pending = await readPending(process.cwd(), { includeResolved: Boolean(flags.all) });
  if (flags.json) {
    console.log(JSON.stringify({ pending }, null, 2));
  } else if (!pending.length) {
    console.log('No pending protected effects.');
  } else {
    for (const entry of pending) {
      console.log(`${entry.id}  ${entry.effectId}  ${entry.status}  ${entry.createdAt}`);
    }
  }
  return 0;
}

async function denyCli(args) {
  const id = args[0];
  if (!id) throw new Error('Usage: effectgate deny <pending-id>');
  const entry = await resolvePendingById({ cwd: process.cwd(), id, status: 'denied' });
  if (!entry) {
    console.error(`No pending entry found for ${id}`);
    return 1;
  }
  console.log(`Denied ${entry.effectId} (${entry.id})`);
  return 0;
}

async function barCli(args) {
  const flags = parseFlags(args);
  if (flags.once) {
    const pending = await readPending(process.cwd());
    const recent = flags.recent ? await readRecentProtectedEffects(process.cwd(), { recent: lastFlagValue(flags, 'recent') }) : [];
    if (flags.json) {
      console.log(JSON.stringify(barJson(pending, recent), null, 2));
    } else {
      console.log(renderBarStatus(pending, { recent }));
    }
    if (flags.notify && pending.length) notifyPending(pending);
    return pending.length ? 2 : 0;
  }

  const intervalMs = Number(flags.interval || 2) * 1000;
  let lastLine = '';
  let lastPendingIds = '';
  for (;;) {
    const pending = await readPending(process.cwd());
    const recent = flags.recent ? await readRecentProtectedEffects(process.cwd(), { recent: lastFlagValue(flags, 'recent') }) : [];
    const line = renderBarStatus(pending, { recent });
    const pendingIds = pending.map((entry) => entry.id).join(',');
    if (line !== lastLine || flags.verbose) {
      process.stdout.write(`${new Date().toLocaleTimeString()}  ${line}\n`);
      lastLine = line;
    }
    if (flags.notify && pending.length && pendingIds !== lastPendingIds) {
      notifyPending(pending);
    }
    lastPendingIds = pendingIds;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function auditCli(args) {
  const flags = parseFlags(args);
  const rows = await readAudit(process.cwd(), Number(flags.limit || 50));
  console.log(rows.map((row) => JSON.stringify(row)).join('\n'));
  return 0;
}

async function protectCli(args) {
  const effectId = args[0];
  if (!effectId) {
    throw new Error('Usage: effectgate protect <effect-id> --keyword chargeCustomer [--file src/**] [--env DATABASE_URL=*prod*]');
  }
  const flags = parseFlags(args.slice(1));
  const result = await protectTripwire(protectInputFromFlags({ cwd: process.cwd(), effectId, flags }));
  console.log(`${result.created ? 'Protected' : 'Updated'} ${effectId} in ${result.configPath}`);
  console.log('Run `effectgate list` to review protected effects, or `effectgate bar --once` to see pending approvals.');
  return 0;
}

async function listCli(args) {
  const flags = parseFlags(args);
  const config = await loadConfig(process.cwd());
  if (flags.json) {
    console.log(JSON.stringify({
      configPath: config.configPath,
      rootDir: config.rootDir,
      tripwires: config.tripwires
    }, null, 2));
    return 0;
  }

  const raw = await listWritableTripwires({ cwd: process.cwd() });
  if (!raw.tripwires.length) {
    console.log('No protected effects configured.');
    return 0;
  }
  for (const tripwire of raw.tripwires) {
    const keywords = listSummary(tripwire.match?.keywords);
    const files = listSummary(tripwire.match?.files);
    const sql = listSummary(tripwire.match?.sql);
    const pieces = [
      `${tripwire.id}`,
      tripwire.risk ? `risk=${tripwire.risk}` : null,
      keywords ? `keywords=${keywords}` : null,
      files ? `files=${files}` : null,
      sql ? `sql=${sql}` : null
    ].filter(Boolean);
    console.log(pieces.join('  '));
  }
  return 0;
}

async function testAlertCli(args) {
  const flags = parseFlags(args);
  const config = await loadConfig(process.cwd());
  const requestedEffectId = firstPositional(args);
  const tripwire = selectTripwire(config, requestedEffectId);

  if (!tripwire) {
    const label = requestedEffectId || 'any effect';
    console.error(`No configured tripwire found for ${label}. Register one with: effectgate protect <effect-id> --keyword <functionName>`);
    return 1;
  }

  const { pendingAlerts } = await createTestAlertForTripwire({ cwd: process.cwd(), tripwire, flags });
  console.log(`Created test alert for ${tripwire.id}`);
  console.log(renderBarStatus(pendingAlerts));
  console.log('Resolve it with `effectgate approve <effect-id>` or `effectgate deny <pending-id>`.');
  return 0;
}

async function verifyInstallCli(args) {
  const flags = parseFlags(args);
  const json = Boolean(flags.json);
  const requestedEffectId = firstPositional(args);
  const config = await loadConfig(process.cwd());
  const report = {
    ok: false,
    effectId: requestedEffectId || null,
    pendingCount: 0,
    checks: {
      config: {
        ok: Boolean(config.configPath && config.tripwires.length),
        path: config.configPath,
        tripwires: config.tripwires.length
      },
      testAlert: { ok: false },
      cliBar: { ok: false },
      daemon: { ok: false },
      surfaces: {}
    },
    next: 'Register a protected effect with: effectgate protect <effect-id> --keyword <functionName>'
  };

  const tripwire = selectTripwire(config, requestedEffectId);
  if (!tripwire) {
    const label = requestedEffectId || 'any effect';
    const message = `No configured tripwire found for ${label}. Run \`effectgate list\` or register one with: effectgate protect <effect-id> --keyword <functionName>`;
    report.error = message;
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(message);
    }
    return 1;
  }

  report.effectId = tripwire.id;
  report.next = `Resolve the test alert with: effectgate approve ${tripwire.id} --ttl 10m --max-calls 1 --scope session`;
  const alert = await createTestAlertForTripwire({ cwd: process.cwd(), tripwire, flags });
  report.checks.testAlert = {
    ok: true,
    pendingId: alert.pending.id
  };
  report.pendingCount = alert.pendingAlerts.length;
  const label = renderBarStatus(alert.pendingAlerts);
  report.checks.cliBar = {
    ok: alert.pendingAlerts.some((entry) => entry.effectId === tripwire.id),
    label
  };
  report.checks.daemon = await verifyDaemonPending({ cwd: process.cwd(), effectId: tripwire.id });
  const surfaces = requestedSurfaces(flags);
  for (const surface of surfaces) {
    if (surface === 'cli') {
      report.checks.surfaces.cli = await verifyCliSurface(process.cwd());
    } else if (surface === 'desktop') {
      report.checks.surfaces.desktop = await verifyDesktopSurface({
        cwd: process.cwd(),
        home: lastFlagValue(flags, 'home') || process.env.HOME,
        effectId: tripwire.id
      });
    } else {
      report.checks.surfaces[surface] = {
        ok: false,
        error: `Unknown surface: ${surface}`,
        next: 'Use --surface cli, --surface desktop, or --surface all'
      };
    }
  }
  const surfacesOk = Object.values(report.checks.surfaces).every((surface) => surface.ok);
  report.ok = report.checks.config.ok && report.checks.testAlert.ok && report.checks.cliBar.ok && report.checks.daemon.ok && surfacesOk;

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printVerifyInstallReport(report);
  }
  return report.ok ? 0 : 1;
}

async function checkCli(args) {
  const effectId = args[0];
  if (!effectId) throw new Error('Usage: effectgate check <effect-id> [--args-json JSON]');
  const flags = parseFlags(args.slice(1));
  const parsedArgs = flags['args-json'] ? JSON.parse(flags['args-json']) : [];
  const result = await checkRuntimeEffect({
    cwd: process.cwd(),
    effectId,
    argsHash: hashArgs(parsedArgs),
    command: flags.command
  });
  if (result.decision === 'allow') {
    if (flags.json) console.log(JSON.stringify(result));
    return 0;
  }
  process.stderr.write(result.card || `EffectGate blocked ${effectId}\n`);
  return result.decision === 'deny' ? 43 : 42;
}

async function checkKeywordCli(args) {
  const flags = parseFlags(args);
  const keyword = args[0];
  const config = await loadConfig(process.cwd());
  const result = await evaluateOperation(config, {
    cwd: process.cwd(),
    command: keyword || '',
    files: flags.file ? [flags.file] : [],
    env: process.env
  });
  if (result.decision === 'allow') return 0;
  process.stderr.write(JSON.stringify(result, null, 2));
  return result.decision === 'deny' ? 43 : 42;
}

async function scanSqlCli(args) {
  const sql = args.join(' ');
  const matches = scanSqlText(sql);
  console.log(JSON.stringify({ matches }, null, 2));
  return matches.length ? 42 : 0;
}

async function scanJavaCli(args) {
  const config = await loadConfig(process.cwd());
  const result = await evaluateOperation(config, {
    cwd: process.cwd(),
    command: args.join(' '),
    files: args,
    env: process.env
  });
  console.log(JSON.stringify(result, null, 2));
  return result.decision === 'allow' ? 0 : result.decision === 'deny' ? 43 : 42;
}

async function scanFileCli(args) {
  const config = await loadConfig(process.cwd());
  const result = await evaluateOperation(config, {
    cwd: process.cwd(),
    command: args.join(' '),
    files: args,
    env: process.env
  });
  console.log(JSON.stringify(result, null, 2));
  return result.decision === 'allow' ? 0 : result.decision === 'deny' ? 43 : 42;
}

async function daemonCli(args) {
  const flags = parseFlags(args);
  const port = Number(flags.port || 8765);
  await startDaemon({ cwd: process.cwd(), port });
  console.log(`EffectGate daemon listening on http://127.0.0.1:${port}`);
  return new Promise(() => {});
}

async function installCli(args) {
  const target = args[0];
  const flags = parseFlags(args.slice(1));
  if (target === 'claude') {
    const result = await installClaude({ cwd: process.cwd(), dryRun: Boolean(flags['dry-run']) });
    console.log(result.message);
    console.log(result.command);
    return 0;
  }
  if (target === 'codex') {
    const result = await installCodex({ dryRun: Boolean(flags['dry-run']) });
    console.log(result.message);
    return 0;
  }
  if (target === 'cli-bar') {
    const result = await installCliBar({ cwd: process.cwd(), dryRun: Boolean(flags['dry-run']) });
    console.log(result.message);
    return 0;
  }
  if (target === 'desktop') {
    const result = await installDesktop({
      cwd: process.cwd(),
      dryRun: Boolean(flags['dry-run']),
      home: flags.home || process.env.HOME,
      start: Boolean(flags.start),
      port: flags.port
    });
    console.log(result.message);
    return 0;
  }
  throw new Error('Usage: effectgate install claude|codex|desktop|cli-bar [--dry-run]');
}

async function setupCli(args) {
  const flags = parseFlags(args);
  const steps = [];
  const protectedEffectId = lastFlagValue(flags, 'protect');
  const hasConfig = await configExists(process.cwd());
  if (protectedEffectId) {
    validateSetupProtectFlags(flags, protectedEffectId);
    if (flags['dry-run']) {
      steps.push(`${hasConfig ? 'Would update' : 'Would create'} .effectgate.yaml`);
      steps.push(`Would protect ${protectedEffectId}`);
    } else {
      const result = await protectTripwire(protectInputFromFlags({
        cwd: process.cwd(),
        effectId: protectedEffectId,
        flags
      }));
      steps.push(`${result.created ? 'Protected' : 'Updated'} ${protectedEffectId} in ${result.configPath}`);
    }
  } else if (flags['dry-run']) {
    steps.push(hasConfig && !flags.force ? '.effectgate.yaml already exists' : 'Would create .effectgate.yaml');
  } else {
    const created = await ensureDefaultConfig({ cwd: process.cwd(), overwrite: Boolean(flags.force) });
    steps.push(created ? 'Created .effectgate.yaml' : '.effectgate.yaml already exists');
  }

  if (flags.claude || noSetupTargets(flags)) {
    const result = await installClaude({ cwd: process.cwd(), dryRun: Boolean(flags['dry-run']) });
    steps.push(result.message);
  }
  if (flags['cli-bar'] || noSetupTargets(flags)) {
    const result = await installCliBar({ cwd: process.cwd(), dryRun: Boolean(flags['dry-run']) });
    steps.push(result.message);
  }
  if (flags.desktop) {
    const result = await installDesktop({
      cwd: process.cwd(),
      dryRun: Boolean(flags['dry-run']),
      home: flags.home || process.env.HOME,
      start: Boolean(flags.start),
      port: flags.port
    });
    steps.push(result.message);
  }
  if (flags.codex) {
    const result = await installCodex({ dryRun: Boolean(flags['dry-run']) });
    steps.push(result.message);
  }
  if (protectedEffectId) {
    const surfaces = [];
    if (flags['cli-bar'] || noSetupTargets(flags)) surfaces.push('cli');
    if (flags.desktop) surfaces.push('desktop');
    const surfaceArg = surfaces.length ? ` --surface ${surfaces.join(',')}` : '';
    steps.push(`Verify it with: effectgate verify-install ${protectedEffectId}${surfaceArg}`);
  }
  console.log(steps.join('\n'));
  return 0;
}

async function demoCli(args) {
  const flags = parseFlags(args);
  const parent = path.resolve(flags.dir || process.cwd());
  const demoDir = path.join(parent, 'effectgate-demo');
  const stateDir = path.join(demoDir, '.effectgate');
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, '.gitignore'), '*\n!.gitignore\n', 'utf8');
  await writeFile(path.join(demoDir, '.effectgate.yaml'), `tripwires:
  - id: billing.charge
    risk: money_movement
    match:
      keywords: ["chargeCustomer"]
    action: ask
    approvals:
      max_ttl: "10m"
      max_calls: 1
`, 'utf8');
  await writeFile(path.join(demoDir, 'charge-demo.mjs'), `import { effect } from ${JSON.stringify(path.join(repoRoot(), 'src/sdk/node.js'))};

const chargeCustomer = effect('billing.charge', (customerId) => {
  console.log('charged', customerId);
});

chargeCustomer('cus_demo');
`, 'utf8');

  const result = await checkRuntimeEffect({
    cwd: demoDir,
    effectId: 'billing.charge',
    argsHash: hashArgs(['cus_demo'])
  });
  const pending = await readPending(demoDir);
  console.log('EffectGate demo is ready');
  console.log(`Demo project: ${demoDir}`);
  console.log(renderBarStatus(pending));
  if (result.card) console.log(result.card.trim());
  console.log('');
  console.log('Try next:');
  console.log(`  cd ${JSON.stringify(demoDir)}`);
  console.log('  effectgate bar --once');
  console.log('  effectgate approve billing.charge --ttl 10m --max-calls 1 --scope session');
  return 0;
}

async function doctorCli(args) {
  const flags = parseFlags(args);
  const report = await doctorReport({ cwd: process.cwd() });
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(`EffectGate doctor
Config: ${report.config.found ? report.config.path : 'missing'}
Tripwires: ${report.tripwires}
Pending: ${report.pending}
CLI: ${report.surfaces.cli ? 'ok' : 'missing'}
Claude adapter: ${report.surfaces.claudeAdapter ? 'ok' : 'missing'}
Codex adapter: ${report.surfaces.codexAdapter ? 'ok' : 'missing'}
Desktop bar source: ${report.surfaces.desktopBarSource ? 'ok' : 'missing'}`);
  return 0;
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const item = args[i];
    if (!item.startsWith('--')) continue;
    const [rawKey, inlineValue] = item.slice(2).split(/=(.*)/s, 2);
    const key = rawKey;
    const next = inlineValue ?? args[i + 1];
    if (next && !next.startsWith('--')) {
      appendFlag(flags, key, next);
      if (inlineValue === undefined) i += 1;
    } else {
      appendFlag(flags, key, true);
    }
  }
  return flags;
}

function appendFlag(flags, key, value) {
  if (flags[key] === undefined) {
    flags[key] = value;
  } else if (Array.isArray(flags[key])) {
    flags[key].push(value);
  } else {
    flags[key] = [flags[key], value];
  }
}

function flagValues(flags, key) {
  const value = flags[key];
  if (value === undefined || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

function lastFlagValue(flags, key) {
  const values = flagValues(flags, key);
  if (!values.length) return undefined;
  return values[values.length - 1];
}

function protectInputFromFlags({ cwd, effectId, flags }) {
  return {
    cwd,
    effectId,
    keywords: [...flagValues(flags, 'keyword'), ...flagValues(flags, 'function')],
    files: flagValues(flags, 'file'),
    sql: flagValues(flags, 'sql'),
    java: flagValues(flags, 'java'),
    env: flagValues(flags, 'env'),
    risk: lastFlagValue(flags, 'risk'),
    action: lastFlagValue(flags, 'action') || 'ask',
    maxTtl: lastFlagValue(flags, 'max-ttl') || lastFlagValue(flags, 'ttl'),
    maxCalls: lastFlagValue(flags, 'max-calls')
  };
}

function validateSetupProtectFlags(flags, effectId) {
  const hasMatcher = ['keyword', 'function', 'file', 'sql', 'java']
    .some((key) => flagValues(flags, key).length);
  if (!hasMatcher) {
    throw new Error(`setup --protect ${effectId} needs at least one matcher, for example: --keyword chargeCustomer`);
  }
}

function listSummary(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.length ? values.join(',') : '';
}

function requestedSurfaces(flags) {
  const values = flagValues(flags, 'surface').flatMap((value) => String(value).split(','));
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.includes('all')) return ['cli', 'desktop'];
  return [...new Set(normalized)];
}

function firstPositional(args) {
  return args[0] && !args[0].startsWith('--') ? args[0] : null;
}

function selectTripwire(config, requestedEffectId) {
  if (!requestedEffectId) return config.tripwires[0] || null;
  return config.tripwires.find((item) => item.id === requestedEffectId) || null;
}

async function createTestAlertForTripwire({ cwd, tripwire, flags }) {
  const parsedArgs = flags['args-json'] ? JSON.parse(lastFlagValue(flags, 'args-json')) : ['effectgate-test-alert'];
  const context = await contextForApproval({
    cwd,
    command: lastFlagValue(flags, 'command'),
    script: lastFlagValue(flags, 'script'),
    argsHash: hashArgs(parsedArgs)
  });
  const decision = tripwire.action === 'deny' ? 'deny' : 'ask';
  const matches = [{
    id: tripwire.id,
    risk: tripwire.risk,
    action: tripwire.action,
    reasons: [{ type: 'test_alert', value: 'safe local verification' }]
  }];
  const pending = await createPending({
    cwd,
    kind: 'test_alert',
    effectId: tripwire.id,
    decision,
    matches,
    context
  });
  await appendAudit(cwd, {
    kind: 'test_alert',
    decision,
    effectId: tripwire.id,
    matches,
    context,
    pendingId: pending.id
  });
  const pendingAlerts = await readPending(cwd);
  return { pending, pendingAlerts, context, matches };
}

async function verifyDaemonPending({ cwd, effectId }) {
  const server = await startDaemon({ cwd, port: 0 });
  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    const url = `http://127.0.0.1:${port}/pending`;
    const response = await fetch(url);
    const body = await response.json();
    const ok = response.status === 200
      && Array.isArray(body.pending)
      && body.pending.some((entry) => entry.effectId === effectId);
    return {
      ok,
      url,
      pendingCount: Array.isArray(body.pending) ? body.pending.length : 0,
      label: body.bar || null
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function printVerifyInstallReport(report) {
  console.log('EffectGate install verification');
  console.log(`Effect: ${report.effectId}`);
  console.log(`Config: ${report.checks.config.ok ? 'ok' : 'missing'}${report.checks.config.path ? ` (${report.checks.config.path})` : ''}`);
  console.log(`Test alert: ${report.checks.testAlert.ok ? 'ok' : 'failed'}${report.checks.testAlert.pendingId ? ` (${report.checks.testAlert.pendingId})` : ''}`);
  console.log(`CLI bar: ${report.checks.cliBar.ok ? 'ok' : 'failed'}${report.checks.cliBar.label ? ` - ${report.checks.cliBar.label}` : ''}`);
  console.log(`Daemon API: ${report.checks.daemon.ok ? 'ok' : 'failed'}${report.checks.daemon.url ? ` (${report.checks.daemon.url})` : ''}`);
  for (const [name, surface] of Object.entries(report.checks.surfaces || {})) {
    console.log(`Installed ${name}: ${surface.ok ? 'ok' : 'missing'}${surface.path ? ` (${surface.path})` : ''}${surface.daemonUrl ? ` ${surface.daemonUrl}` : ''}`);
    if (!surface.ok && surface.next) console.log(surface.next);
  }
  console.log(report.next);
}

async function verifyCliSurface(cwd) {
  const scriptPath = path.join(cwd, '.effectgate', 'effectgate-bar.sh');
  try {
    const script = await readFile(scriptPath, 'utf8');
    const recentWindow = extractRecentWindow(script);
    const ok = script.includes('bar --once')
      && script.includes(path.resolve(cwd))
      && Boolean(recentWindow);
    return {
      ok,
      path: scriptPath,
      recentWindow,
      next: ok ? null : 'Reinstall the helper with: effectgate install cli-bar'
    };
  } catch {
    return {
      ok: false,
      path: scriptPath,
      next: 'Install the CLI helper with: effectgate install cli-bar'
    };
  }
}

function extractRecentWindow(script) {
  const envDefault = script.match(/\$\{EFFECTGATE_RECENT_WINDOW:-([^}]+)\}/);
  if (envDefault) return envDefault[1];
  const flagDefault = script.match(/--recent\s+['"]?([^'"\s]+)/);
  return flagDefault?.[1] || null;
}

async function verifyDesktopSurface({ cwd, home, effectId }) {
  const projectHash = Buffer.from(path.resolve(cwd)).toString('hex').slice(0, 16);
  const launchAgentsDir = path.join(home || process.env.HOME || process.cwd(), 'Library', 'LaunchAgents');
  const daemonPlist = path.join(launchAgentsDir, `dev.effectgate.${projectHash}.daemon.plist`);
  const barPlist = path.join(launchAgentsDir, `dev.effectgate.${projectHash}.bar.plist`);
  try {
    const [daemonText, barText] = await Promise.all([
      readFile(daemonPlist, 'utf8'),
      readFile(barPlist, 'utf8')
    ]);
    const port = extractPlistArgAfter(daemonText, '--port');
    const daemonUrl = extractEnvironmentValue(barText, 'EFFECTGATE_DAEMON_URL');
    const binary = extractFirstProgramArgument(barText);
    const expectedUrl = port ? `http://127.0.0.1:${port}` : null;
    const launchAgentsOk = Boolean(
      port
      && daemonUrl === expectedUrl
      && daemonText.includes(path.resolve(cwd))
      && binary
      && barText.includes('EffectGateMenuBar')
    );
    const selfTest = launchAgentsOk
      ? await runDesktopSelfTest({ cwd, binary, effectId })
      : { ok: false, error: 'LaunchAgent wiring is incomplete' };
    return {
      ok: launchAgentsOk && selfTest.ok,
      daemonPlist,
      barPlist,
      binary,
      daemonPort: port ? Number(port) : null,
      daemonUrl,
      selfTest,
      next: launchAgentsOk && selfTest.ok ? null : 'Reinstall desktop support with: effectgate install desktop'
    };
  } catch {
    return {
      ok: false,
      daemonPlist,
      barPlist,
      next: 'Install desktop support with: effectgate install desktop'
    };
  }
}

function extractPlistArgAfter(text, arg) {
  const escaped = escapeRegExp(arg);
  const match = text.match(new RegExp(`<string>${escaped}<\\/string>\\s*<string>([^<]+)<\\/string>`));
  return match?.[1] || null;
}

function extractEnvironmentValue(text, key) {
  const escaped = escapeRegExp(key);
  const match = text.match(new RegExp(`<key>${escaped}<\\/key>\\s*<string>([^<]+)<\\/string>`));
  return match?.[1] || null;
}

function extractFirstProgramArgument(text) {
  const match = text.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/);
  return match?.[1] || null;
}

async function runDesktopSelfTest({ cwd, binary, effectId }) {
  const server = await startDaemon({ cwd, port: 0 });
  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    const daemonUrl = `http://127.0.0.1:${port}`;
    const result = await runProcess(binary, [], {
      env: {
        ...process.env,
        EFFECTGATE_SELF_TEST: '1',
        EFFECTGATE_DAEMON_URL: daemonUrl
      },
      timeoutMs: 7000
    });
    return {
      ok: result.status === 0 && result.stdout.includes(effectId),
      status: result.status,
      daemonUrl,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function runProcess(command, args, { env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Timed out running ${command}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printHelp() {
  console.log(`EffectGate

Usage:
  effectgate init
  effectgate run -- <command>
  effectgate approve <effect-id> --ttl 10m --max-calls 1 --scope session
  effectgate protect <effect-id> --keyword chargeCustomer
  effectgate setup --protect <effect-id> --keyword chargeCustomer --cli-bar
  effectgate list
  effectgate test-alert [effect-id]
  effectgate verify-install [effect-id] [--surface cli|desktop]
  effectgate pending
  effectgate bar --once
  effectgate bar --once --recent 1h
  effectgate install claude|codex|desktop|cli-bar
  effectgate setup --claude --cli-bar
  effectgate doctor
  effectgate demo
  effectgate check <effect-id> --args-json '[...]'
  effectgate status
  effectgate audit
`);
}

function barJson(pending, recent = []) {
  return {
    label: renderBarStatus(pending, { recent }),
    pendingCount: pending.length,
    recentCount: recent.length,
    attention: pending.length > 0,
    effects: [...new Set(pending.map((entry) => entry.effectId))],
    recentEffects: [...new Set(recent.map((entry) => entry.effectId))],
    pending,
    recent
  };
}

function noSetupTargets(flags) {
  return !flags.claude && !flags.codex && !flags.desktop && !flags['cli-bar'];
}

async function configExists(cwd) {
  try {
    await access(path.join(cwd, '.effectgate.yaml'));
    return true;
  } catch {
    return false;
  }
}

function notifyPending(pending) {
  if (process.platform !== 'darwin') return;
  const title = `EffectGate: ${pending.length} pending protected effect${pending.length === 1 ? '' : 's'}`;
  const message = pending.slice(0, 3).map((entry) => entry.effectId).join(', ');
  spawnSync('osascript', [
    '-e',
    `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`
  ], { stdio: 'ignore' });
}
