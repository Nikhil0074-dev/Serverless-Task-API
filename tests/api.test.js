'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../src/handler');
const { MemoryStore, setStore } = require('../src/store');
const { validateTask } = require('../src/validation');

const call = (method, path, body, extra = {}) =>
  handler({
    version: '2.0', rawPath: path, headers: { 'content-type': 'application/json', ...(extra.headers || {}) },
    queryStringParameters: extra.query, requestContext: { http: { method } },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
const parse = (r) => (r.body ? JSON.parse(r.body) : null);

beforeEach(() => setStore(new MemoryStore()));

test('GET /health returns 200', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.statusCode, 200);
  assert.equal(parse(r).data.status, 'healthy');
});

test('POST /tasks creates a task (201 + Location header)', async () => {
  const r = await call('POST', '/tasks', { title: '  Write docs ', priority: 'high', dueDate: '2026-11-01' });
  assert.equal(r.statusCode, 201);
  const t = parse(r).data;
  assert.equal(t.title, 'Write docs');
  assert.equal(t.status, 'todo');
  assert.equal(t.priority, 'high');
  assert.match(r.headers.Location, /^\/tasks\/[0-9a-f-]{36}$/);
});

test('POST /tasks rejects invalid payloads with 400', async () => {
  const bad = [
    {}, { title: '' }, { title: 123 }, { title: 'x'.repeat(121) },
    { title: 'ok', status: 'finished' }, { title: 'ok', priority: 'urgent' },
    { title: 'ok', dueDate: '2026-02-30' }, { title: 'ok', dueDate: '01/11/2026' },
    { title: 'ok', hacker: true }, [], 'string-body-as-json',
  ];
  for (const b of bad) {
    const r = await call('POST', '/tasks', JSON.stringify(b));
    assert.equal(r.statusCode, 400, `expected 400 for ${JSON.stringify(b)}`);
  }
});

test('malformed JSON, missing body and wrong content-type -> 400', async () => {
  assert.equal((await call('POST', '/tasks', '{bad json')).statusCode, 400);
  assert.equal((await call('POST', '/tasks', undefined)).statusCode, 400);
  const r = await call('POST', '/tasks', '{"title":"x"}', { headers: { 'content-type': 'text/plain' } });
  assert.equal(r.statusCode, 400);
});

test('GET /tasks lists and filters by status', async () => {
  await call('POST', '/tasks', { title: 'a' });
  const b = parse(await call('POST', '/tasks', { title: 'b' })).data;
  await call('PATCH', `/tasks/${b.id}`, { status: 'done' });
  const all = parse(await call('GET', '/tasks'));
  assert.equal(all.count, 2);
  const done = parse(await call('GET', '/tasks', undefined, { query: { status: 'done' } }));
  assert.equal(done.count, 1);
  assert.equal((await call('GET', '/tasks', undefined, { query: { status: 'nope' } })).statusCode, 400);
});

test('GET /tasks/{id}: 200, 404, and 400 for bad id', async () => {
  const t = parse(await call('POST', '/tasks', { title: 'x' })).data;
  assert.equal((await call('GET', `/tasks/${t.id}`)).statusCode, 200);
  assert.equal((await call('GET', '/tasks/11111111-1111-4111-8111-111111111111')).statusCode, 404);
  assert.equal((await call('GET', '/tasks/not-a-uuid')).statusCode, 400);
});

test('PUT/PATCH updates fields and bumps updatedAt', async () => {
  const t = parse(await call('POST', '/tasks', { title: 'x' })).data;
  await new Promise((r) => setTimeout(r, 5));
  const r = await call('PUT', `/tasks/${t.id}`, { status: 'in_progress', title: 'renamed' });
  assert.equal(r.statusCode, 200);
  const u = parse(r).data;
  assert.equal(u.status, 'in_progress');
  assert.equal(u.title, 'renamed');
  assert.ok(u.updatedAt > t.updatedAt);
  assert.equal(u.createdAt, t.createdAt);
});

test('update validation: empty body, bad field, unknown id', async () => {
  const t = parse(await call('POST', '/tasks', { title: 'x' })).data;
  assert.equal((await call('PATCH', `/tasks/${t.id}`, {})).statusCode, 400);
  assert.equal((await call('PATCH', `/tasks/${t.id}`, { status: 'bad' })).statusCode, 400);
  assert.equal((await call('PATCH', '/tasks/11111111-1111-4111-8111-111111111111', { status: 'done' })).statusCode, 404);
});

test('DELETE removes the task (204) then 404', async () => {
  const t = parse(await call('POST', '/tasks', { title: 'x' })).data;
  assert.equal((await call('DELETE', `/tasks/${t.id}`)).statusCode, 204);
  assert.equal((await call('DELETE', `/tasks/${t.id}`)).statusCode, 404);
});

test('CORS: OPTIONS pre-flight and headers on every response', async () => {
  const pre = await call('OPTIONS', '/tasks');
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers['Access-Control-Allow-Origin'], '*');
  assert.match(pre.headers['Access-Control-Allow-Methods'], /POST/);
  for (const r of [await call('GET', '/tasks'), await call('POST', '/tasks', {}), await call('GET', '/nowhere')]) {
    assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
  }
});

test('unknown route 404, unsupported method 405, stage prefix + trailing slash handled', async () => {
  assert.equal((await call('GET', '/nope')).statusCode, 404);
  assert.equal((await call('DELETE', '/tasks')).statusCode, 405);
  assert.equal((await call('GET', '/dev/tasks/')).statusCode, 200);
});

test('store failures are returned as 500 without leaking internals', async () => {
  setStore({ list: async () => { throw new Error('db exploded: secret-host'); } });
  const origErr = console.error; console.error = () => {};
  const r = await call('GET', '/tasks');
  console.error = origErr;
  assert.equal(r.statusCode, 500);
  assert.ok(!r.body.includes('secret-host'));
});

test('validateTask unit checks', () => {
  assert.equal(validateTask({ title: 'ok' }).valid, true);
  assert.equal(validateTask({ dueDate: null }, { partial: true }).valid, true);
  assert.equal(validateTask(null).valid, false);
});

test('local HTTP server end-to-end (real sockets)', async () => {
  const { server } = require('../local-server');
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${base}/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'http://example.com' }, body: JSON.stringify({ title: 'e2e' }) });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('access-control-allow-origin'), '*');
  const bad = await fetch(`${base}/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":' });
  assert.equal(bad.status, 400);
  await new Promise((r) => server.close(r));
});
