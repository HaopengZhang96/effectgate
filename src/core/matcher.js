import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';

export async function evaluateOperation(config, operation = {}) {
  const cwd = path.resolve(operation.cwd || config.rootDir || process.cwd());
  const command = operation.command || '';
  const sql = operation.sql || '';
  const env = operation.env || process.env;
  const explicitFiles = (operation.files || []).map((file) => path.resolve(cwd, file));
  const discovered = await discoverCommandFiles(command, cwd);
  const files = [...new Set([...explicitFiles, ...discovered])];
  const fileContents = await readSmallFiles(files);
  const haystack = [
    command,
    sql,
    ...fileContents.map((entry) => entry.content)
  ].join('\n');

  const matches = [];
  for (const builtin of scanSqlText(sql || command)) {
    matches.push(builtin);
  }
  for (const tripwire of config.tripwires || []) {
    const match = matchTripwire(tripwire, { cwd, command, sql, env, files, fileContents, haystack });
    if (match) matches.push(match);
  }

  const decision = matches.some((match) => match.action === 'deny')
    ? 'deny'
    : matches.some((match) => match.action === 'ask')
      ? 'ask'
      : 'allow';

  return { decision, matches };
}

export function matchTripwire(tripwire, context) {
  if (!envConditionsMatch(tripwire.when?.env || {}, context.env || {})) return null;

  const reasons = [];
  for (const keyword of tripwire.match.keywords || []) {
    if (keyword && context.haystack.includes(keyword)) {
      reasons.push({ type: 'keyword', value: keyword });
    }
  }

  for (const pattern of tripwire.match.files || []) {
    for (const file of context.files || []) {
      const rel = normalizePath(path.relative(context.cwd, file));
      if (minimatch(rel, pattern, { dot: true })) {
        reasons.push({ type: 'file', value: rel, pattern });
      }
    }
  }

  for (const pattern of tripwire.match.sql || []) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(context.sql || context.haystack || '')) {
      reasons.push({ type: 'sql', value: pattern });
    }
  }

  for (const pattern of tripwire.match.java || []) {
    if ((context.haystack || '').includes(pattern)) {
      reasons.push({ type: 'java', value: pattern });
    }
  }

  if (reasons.length === 0) return null;
  return {
    id: tripwire.id,
    risk: tripwire.risk,
    action: tripwire.action,
    reasons
  };
}

export function scanSqlText(text = '') {
  const matches = [];
  if (/\bTRUNCATE\s+(TABLE\s+)?[A-Za-z0-9_."`[\]-]+/i.test(text)) {
    matches.push({
      id: 'builtin.sql.truncate',
      risk: 'destructive_sql',
      action: 'ask',
      reasons: [{ type: 'sql_builtin', value: 'TRUNCATE TABLE' }]
    });
  }
  if (/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i.test(text)) {
    matches.push({
      id: 'builtin.sql.drop',
      risk: 'destructive_sql',
      action: 'ask',
      reasons: [{ type: 'sql_builtin', value: 'DROP' }]
    });
  }
  const deleteMatch = text.match(/\bDELETE\s+FROM\s+[A-Za-z0-9_."`[\]-]+([\s\S]*?)(;|$)/i);
  if (deleteMatch && !/\bWHERE\b/i.test(deleteMatch[1])) {
    matches.push({
      id: 'builtin.sql.delete_without_where',
      risk: 'destructive_sql',
      action: 'ask',
      reasons: [{ type: 'sql_builtin', value: 'DELETE without WHERE' }]
    });
  }
  return matches;
}

function envConditionsMatch(conditions, env) {
  for (const [key, pattern] of Object.entries(conditions || {})) {
    const actual = env[key];
    if (actual === undefined) return false;
    if (!wildcardMatch(String(actual), String(pattern))) return false;
  }
  return true;
}

function wildcardMatch(actual, pattern) {
  if (pattern.includes('*') || pattern.includes('?')) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i').test(actual);
  }
  return actual === pattern;
}

async function discoverCommandFiles(command, cwd) {
  const tokens = shellishTokens(command);
  const files = [];
  for (const token of tokens) {
    const cleaned = token.replace(/^file:\/\//, '');
    if (!looksLikePath(cleaned)) continue;
    const candidate = path.isAbsolute(cleaned) ? cleaned : path.resolve(cwd, cleaned);
    try {
      const info = await stat(candidate);
      if (info.isFile()) files.push(candidate);
    } catch {
      // ignore command tokens that are not files
    }
  }
  return files;
}

function shellishTokens(command) {
  const matches = String(command).match(/"[^"]+"|'[^']+'|[^\s]+/g) || [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ''));
}

function looksLikePath(token) {
  return token.includes('/') || /\.(js|cjs|mjs|ts|tsx|py|java|sql|sh|bash|zsh)$/i.test(token);
}

async function readSmallFiles(files) {
  const entries = [];
  for (const file of files) {
    try {
      const info = await stat(file);
      if (info.size > 512 * 1024) continue;
      entries.push({ file, content: await readFile(file, 'utf8') });
    } catch {
      // ignore unreadable files during preflight
    }
  }
  return entries;
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}
