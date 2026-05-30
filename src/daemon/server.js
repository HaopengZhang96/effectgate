import http from 'node:http';
import { createApproval, listApprovals } from '../core/approval-store.js';
import { readAudit, readRecentProtectedEffects } from '../core/audit.js';
import { contextForApproval } from '../core/context.js';
import { readPending, renderBarStatus, resolvePendingByEffect, resolvePendingById } from '../core/pending-store.js';

export function startDaemon({ cwd = process.cwd(), port = 8765, host = '127.0.0.1' } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
      if (request.method === 'GET' && url.pathname === '/healthz') {
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/approvals') {
        return sendJson(response, 200, { approvals: await listApprovals(cwd) });
      }
      if (request.method === 'GET' && url.pathname === '/pending') {
        const pending = await readPending(cwd);
        return sendJson(response, 200, { pending, bar: renderBarStatus(pending) });
      }
      if (request.method === 'GET' && url.pathname === '/summary') {
        const pending = await readPending(cwd);
        const recent = await readRecentProtectedEffects(cwd, {
          recent: url.searchParams.get('recent') || '15m'
        });
        return sendJson(response, 200, {
          pending,
          recent,
          bar: renderBarStatus(pending, { recent })
        });
      }
      if (request.method === 'GET' && url.pathname === '/audit') {
        return sendJson(response, 200, { audit: await readAudit(cwd, Number(url.searchParams.get('limit') || 50)) });
      }
      if (request.method === 'POST' && url.pathname === '/approve') {
        const body = await readJsonBody(request);
        const context = await contextForApproval({
          cwd,
          command: body.command,
          script: body.script,
          argsHash: body.argsHash
        });
        const approval = await createApproval({
          cwd,
          effectId: body.effectId,
          ttl: body.ttl || '10m',
          maxCalls: Number(body.maxCalls || 1),
          scope: body.scope || 'session',
          context
        });
        await resolvePendingByEffect({ cwd, effectId: body.effectId, status: 'approved' });
        return sendJson(response, 200, { approval });
      }
      if (request.method === 'POST' && url.pathname === '/deny') {
        const body = await readJsonBody(request);
        const pending = await resolvePendingById({ cwd, id: body.id, status: 'denied' });
        if (!pending) return sendJson(response, 404, { error: 'pending_not_found' });
        return sendJson(response, 200, { pending });
      }
      return sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      return sendJson(response, 500, { error: error.message });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(`${JSON.stringify(data)}\n`);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}
