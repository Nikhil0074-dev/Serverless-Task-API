'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTask, getTask, listTasks, updateTask } = require('../src/handlers/tasks');
const { MemoryStore, setStore } = require('../src/lib/store');

const body = (r) => JSON.parse(r.body);
const post = (payload) => createTask({ body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

test.beforeEach(() => setStore(new MemoryStore()));

test('POST create -> 201 with Location and CORS headers', async () => {
  const r = await post({ title: 'Write docs', priority: 'high' });
  assert.equal(r.statusCode, 201);
  const task = body(r).data;
  assert.equal(task.title, 'Write docs');
  assert.equal(task.status, 'todo');
  assert.equal(r.headers.Location, `/tasks/${task.id}`);
  assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
});

test('POST create -> 400 for malformed payloads', async () => {
  const cases = [
    undefined,
    '',
    '{not json',
    '[]',
    '"str"',
    '{}',
    JSON.stringify({ title: 123 }),
    JSON.stringify({ title: 'ok', status: 'bad' }),
    JSON.stringify({ title: 'ok', hacker: true }),
  ];
  for (const c of cases) {
    const r = await createTask({ body: c });
    assert.equal(r.statusCode, 400, `case: ${c}`);
    assert.equal(body(r).error.code, 'BAD_REQUEST');
  }
});

test('POST create -> 400 includes field-level details', async () => {
  const r = await post({ status: 'bad' });
  const fields = body(r).error.details.map((d) => d.field).sort();
  assert.deepEqual(fields, ['status', 'title']);
});

test('POST create handles base64 body and rejects oversized body (413)', async () => {
  const b64 = Buffer.from(JSON.stringify({ title: 'b64' })).toString('base64');
  const ok = await createTask({ body: b64, isBase64Encoded: true });
  assert.equal(ok.statusCode, 201);
  const big = await createTask({ body: JSON.stringify({ title: 'x', description: 'y'.repeat(11000) }) });
  assert.equal(big.statusCode, 413);
});

test('GET by id -> 200, 404, and 400 for bad id', async () => {
  const created = body(await post({ title: 'Find me' })).data;
  const ok = await getTask({ pathParameters: { id: created.id } });
  assert.equal(ok.statusCode, 200);
  assert.equal(body(ok).data.title, 'Find me');

  const missing = await getTask({ pathParameters: { id: '3f2b8c1e-5d4a-4b7e-9c11-0a1b2c3d4e5f' } });
  assert.equal(missing.statusCode, 404);
  assert.equal(body(missing).error.code, 'NOT_FOUND');

  assert.equal((await getTask({ pathParameters: { id: 'abc' } })).statusCode, 400);
  assert.equal((await getTask({})).statusCode, 400);
});

test('GET list -> 200 with filter, limit, and 400 on bad query', async () => {
  await post({ title: 'a' });
  await post({ title: 'b', status: 'done' });
  const all = body(await listTasks({})).data;
  assert.equal(all.count, 2);
  const done = body(await listTasks({ queryStringParameters: { status: 'done' } })).data;
  assert.equal(done.count, 1);
  assert.equal(done.items[0].title, 'b');
  assert.equal((await listTasks({ queryStringParameters: { limit: '1' } })).statusCode, 200);
  assert.equal((await listTasks({ queryStringParameters: { limit: '0' } })).statusCode, 400);
  assert.equal((await listTasks({ queryStringParameters: { status: 'zzz' } })).statusCode, 400);
});

test('PATCH update -> 200, 400, 404', async () => {
  const created = body(await post({ title: 'Old' })).data;
  const id = created.id;

  const ok = await updateTask({ pathParameters: { id }, body: JSON.stringify({ title: 'New', status: 'done' }) });
  assert.equal(ok.statusCode, 200);
  assert.equal(body(ok).data.title, 'New');
  assert.equal(body(ok).data.status, 'done');

  for (const b of [undefined, '{bad', '{}', JSON.stringify({ status: 'x' }), JSON.stringify({ id: 'z' })]) {
    assert.equal((await updateTask({ pathParameters: { id }, body: b })).statusCode, 400, `case: ${b}`);
  }
  assert.equal(
    (await updateTask({ pathParameters: { id: 'bad' }, body: JSON.stringify({ title: 'x' }) })).statusCode, 400);
  assert.equal(
    (await updateTask({
      pathParameters: { id: '3f2b8c1e-5d4a-4b7e-9c11-0a1b2c3d4e5f' },
      body: JSON.stringify({ title: 'x' }),
    })).statusCode, 404);
});

test('unexpected store failure -> 500 without leaking details', async () => {
  setStore({ create: async () => { throw new Error('secret db password'); } });
  const orig = console.error; console.error = () => {};
  try {
    const r = await post({ title: 'x' });
    assert.equal(r.statusCode, 500);
    assert.equal(body(r).error.message, 'Internal server error');
    assert.ok(!r.body.includes('secret'));
    assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
  } finally { console.error = orig; }
});

test('handlers tolerate undefined event', async () => {
  assert.equal((await createTask()).statusCode, 400);
});
