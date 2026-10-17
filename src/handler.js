'use strict';
// Single Lambda entry point (API Gateway HTTP API payload v2 / v1 compatible).
// Routes: POST /tasks | GET /tasks | GET /tasks/{id} | PUT|PATCH /tasks/{id} | DELETE /tasks/{id} | GET /health

const res = require('./response');
const { validateTask, isValidId, STATUSES } = require('./validation');
const { getStore } = require('./store');

const MAX_BODY_BYTES = 64 * 1024;

function parseBody(event) {
  let raw = event.body;
  if (raw === undefined || raw === null || raw === '') return { ok: false, error: 'Request body is required' };
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { ok: false, error: 'Request body too large (max 64 KB)' };
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const ct = headers['content-type'] || '';
  if (ct && !ct.toLowerCase().includes('application/json')) return { ok: false, error: 'Content-Type must be application/json' };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: 'Malformed JSON in request body' };
  }
}

function resolveRoute(event) {
  const method = (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
  const rawPath = (event.rawPath || event.path || '/').replace(/\/+$/, '') || '/';
  // strip an optional stage prefix like /dev, /prod, /qa, or /staging
  const path = rawPath.replace(/^\/[^/]+(?=\/)/, '') || '/';
  const match = path.match(/^\/tasks(?:\/([^/]+))?$/);
  return { method, path, isTasks: !!match, id: match ? match[1] : undefined };
}

async function handler(event) {
  try {
    const { method, path, isTasks, id } = resolveRoute(event);
    const isHead = method === 'HEAD';
    const effectiveMethod = isHead ? 'GET' : method;

    if (method === 'OPTIONS') return res.noContent();
    if (path === '/health' && effectiveMethod === 'GET') {
      const response = res.ok({ status: 'healthy', time: new Date().toISOString() });
      return isHead ? { ...response, body: '' } : response;
    }
    if (!isTasks) return res.notFound(`No route for ${method} ${path}`);

    const store = getStore();

    // ---- collection: /tasks ------------------------------------------------
    if (!id) {
      if (effectiveMethod === 'POST') {
        const body = parseBody(event);
        if (!body.ok) return res.badRequest(body.error);
        const v = validateTask(body.value);
        if (!v.valid) return res.badRequest('Validation failed', v.errors);
        const task = await store.create(v.value);
        const response = res.created(task, `/tasks/${task.id}`);
        return isHead ? { ...response, body: '' } : response;
      }
      if (effectiveMethod === 'GET') {
        const status = typeof event.queryStringParameters?.status === 'string'
          ? event.queryStringParameters.status.trim().toLowerCase()
          : event.queryStringParameters?.status;
        if (status && !STATUSES.includes(status)) return res.badRequest(`status filter must be one of: ${STATUSES.join(', ')}`);
        const tasks = await store.list({ status });
        const response = res.json(200, { data: tasks, count: tasks.length });
        return isHead ? { ...response, body: '' } : response;
      }
      return res.methodNotAllowed(method);
    }

    // ---- item: /tasks/{id} -------------------------------------------------
    if (!isValidId(id)) return res.badRequest('Task id must be a valid UUID');

    if (effectiveMethod === 'GET') {
      const task = await store.get(id);
      const response = task ? res.ok(task) : res.notFound(`Task ${id} not found`);
      return isHead ? { ...response, body: '' } : response;
    }
    if (effectiveMethod === 'PUT' || effectiveMethod === 'PATCH') {
      const body = parseBody(event);
      if (!body.ok) return res.badRequest(body.error);
      const v = validateTask(body.value, { partial: true });
      if (!v.valid) return res.badRequest('Validation failed', v.errors);
      const task = await store.update(id, v.value);
      const response = task ? res.ok(task) : res.notFound(`Task ${id} not found`);
      return isHead ? { ...response, body: '' } : response;
    }
    if (method === 'DELETE') {
      const removed = await store.remove(id);
      return removed ? res.noContent() : res.notFound(`Task ${id} not found`);
    }
    return res.methodNotAllowed(method);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', message: err.message, stack: err.stack }));
    return res.serverError();
  }
}

module.exports = { handler };
