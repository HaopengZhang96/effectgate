import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { findConfig } from './config.js';

export async function protectTripwire({
  cwd = process.cwd(),
  effectId,
  keywords = [],
  files = [],
  sql = [],
  java = [],
  env = [],
  risk,
  action = 'ask',
  maxTtl,
  maxCalls
} = {}) {
  if (!effectId || typeof effectId !== 'string') {
    throw new Error('protect requires an effect id, for example: effectgate protect billing.charge --keyword chargeCustomer');
  }
  if (!['allow', 'ask', 'deny'].includes(action)) {
    throw new Error(`Invalid action for ${effectId}: ${action}`);
  }

  const loaded = await readWritableConfig(cwd);
  const raw = loaded.raw;
  raw.tripwires ||= [];
  if (!Array.isArray(raw.tripwires)) {
    throw new Error(`${loaded.configPath} has invalid tripwires: expected an array`);
  }

  let tripwire = raw.tripwires.find((entry) => entry?.id === effectId);
  const created = !tripwire;
  if (!tripwire) {
    tripwire = {
      id: effectId,
      match: {},
      action: 'ask',
      approvals: {}
    };
    raw.tripwires.push(tripwire);
  }

  if (risk) tripwire.risk = risk;
  tripwire.action = action || tripwire.action || 'ask';
  tripwire.match ||= {};
  mergeStringList(tripwire.match, 'keywords', keywords);
  mergeStringList(tripwire.match, 'files', files);
  mergeStringList(tripwire.match, 'sql', sql);
  mergeStringList(tripwire.match, 'java', java);

  const envMap = parseEnvEntries(env);
  if (Object.keys(envMap).length) {
    tripwire.when ||= {};
    tripwire.when.env ||= {};
    Object.assign(tripwire.when.env, envMap);
  }

  if (maxTtl || maxCalls) {
    tripwire.approvals ||= {};
    if (maxTtl) tripwire.approvals.max_ttl = maxTtl;
    if (maxCalls) tripwire.approvals.max_calls = Number(maxCalls);
  }

  cleanupTripwire(tripwire);
  await ensureStateDir(loaded.rootDir);
  await writeConfig(loaded.configPath, raw, loaded.format);

  return {
    created,
    configPath: loaded.configPath,
    rootDir: loaded.rootDir,
    tripwire
  };
}

export async function listWritableTripwires({ cwd = process.cwd() } = {}) {
  const loaded = await readWritableConfig(cwd, { create: false });
  return {
    configPath: loaded.configPath,
    rootDir: loaded.rootDir,
    tripwires: Array.isArray(loaded.raw.tripwires) ? loaded.raw.tripwires : []
  };
}

async function readWritableConfig(cwd, { create = true } = {}) {
  const found = await findConfig(cwd);
  if (found) {
    const text = await readFile(found, 'utf8');
    const format = found.endsWith('.json') ? 'json' : 'yaml';
    const raw = format === 'json' ? JSON.parse(text || '{}') : YAML.parse(text || '{}');
    return {
      configPath: found,
      rootDir: path.dirname(found),
      format,
      raw: raw || {}
    };
  }

  if (!create) {
    return {
      configPath: path.join(cwd, '.effectgate.yaml'),
      rootDir: path.resolve(cwd),
      format: 'yaml',
      raw: { tripwires: [] }
    };
  }

  const configPath = path.join(cwd, '.effectgate.yaml');
  return {
    configPath,
    rootDir: path.resolve(cwd),
    format: 'yaml',
    raw: { tripwires: [] }
  };
}

async function writeConfig(configPath, raw, format) {
  const text = format === 'json'
    ? `${JSON.stringify(raw, null, 2)}\n`
    : YAML.stringify(raw);
  await writeFile(configPath, text, 'utf8');
}

async function ensureStateDir(rootDir) {
  const stateDir = path.join(rootDir, '.effectgate');
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx' }).catch((error) => {
    if (error?.code !== 'EEXIST') throw error;
  });
}

function mergeStringList(target, key, values) {
  const existing = toStringList(target[key]);
  const next = toStringList(values);
  const merged = [...new Set([...existing, ...next].filter(Boolean))];
  if (merged.length) target[key] = merged;
}

function parseEnvEntries(entries) {
  const env = {};
  for (const entry of toStringList(entries)) {
    const index = entry.indexOf('=');
    if (index <= 0) {
      throw new Error(`Invalid --env ${entry}: expected KEY=value`);
    }
    env[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return env;
}

function cleanupTripwire(tripwire) {
  if (tripwire.approvals && Object.keys(tripwire.approvals).length === 0) delete tripwire.approvals;
  if (tripwire.when?.env && Object.keys(tripwire.when.env).length === 0) delete tripwire.when.env;
  if (tripwire.when && Object.keys(tripwire.when).length === 0) delete tripwire.when;
  if (tripwire.match && Object.keys(tripwire.match).length === 0) delete tripwire.match;
}

function toStringList(value) {
  if (value === undefined || value === null || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(toStringList);
  return [String(value)];
}
