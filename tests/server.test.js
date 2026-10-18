'use strict';
// End-to-end HTTP test against the local server (real handlers, in-memory store).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../scripts/local-server');
const { MemoryStore, setStore } = require('../src/lib/store');

let server, base;

test.before(async () => {
  setStore(new MemoryStore());
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

const call = (path, opts = {}) =>
  fetch(base + path, { headers: { 'Content-Type': 'application/json' }, ...opts });

test('full lifecycle: create -> get -> update -> list', async () => {
  const c = await call('/tasks', { method: 'POST', body: JSON.stringify({ title: 'E2E', dueDate: '2031-01-15' }) });
  assert.equal(c.status, 201);
  const task = (await c.json()).data;

  const g = await call(`/tasks/${task.id}`);
  assert.equal(g.status, 200);
  assert.equal((await g.json()).data.dueDate, '2031-01-15');

  const u = await call(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'in_progress' }) });
  assert.equal(u.status, 200);
  assert.equal((await u.json()).data.status, 'in_progress');

  const l = await call('/tasks?status=in_progress');
  assert.equal((await l.json()).data.count, 1);
});

test('CORS preflight returns 204 with allow headers', async () => {
  const r = await fetch(base + '/tasks', {
    method: 'OPTIONS',
    headers: { Origin: 'http://example.com', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-allow-methods'), /POST/);
  assert.match(r.headers.get('access-control-allow-headers'), /Content-Type/i);
});

test('malformed JSON -> 400, missing body -> 400', async () => {
  const bad = await call('/tasks', { method: 'POST', body: '{oops' });
  assert.equal(bad.status, 400);
  const none = await call('/tasks', { method: 'POST' });
  assert.equal(none.status, 400);
  assert.equal(none.headers.get('access-control-allow-origin'), '*');
});

test('404 unknown route, 405 wrong method, 404 unknown task', async () => {
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/tasks', { method: 'DELETE' })).status, 405);
  assert.equal((await call('/tasks/3f2b8c1e-5d4a-4b7e-9c11-0a1b2c3d4e5f')).status, 404);
});
