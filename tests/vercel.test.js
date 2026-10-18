'use strict';
// Tests the Vercel entry points (api/*.mjs) by calling their fetch() with real Request objects,
// and the Redis store against a fake Upstash REST endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryStore, setStore, getStore } = require('../src/lib/store');
const { RedisStore } = require('../src/lib/redis-store');

let collection, item;
test.before(async () => {
  collection = (await import('../api/tasks/index.mjs')).default;
  item = (await import('../api/tasks/[id].mjs')).default;
});
test.beforeEach(() => setStore(new MemoryStore()));

const req = (path, init = {}) => new Request(`https://example.vercel.app${path}`, init);
const json = { 'Content-Type': 'application/json' };

test('vercel: full lifecycle through fetch handlers', async () => {
  const c = await collection.fetch(req('/tasks', { method: 'POST', headers: json, body: JSON.stringify({ title: 'V1' }) }));
  assert.equal(c.status, 201);
  assert.equal(c.headers.get('access-control-allow-origin'), '*');
  const task = (await c.json()).data;

  const g = await item.fetch(req(`/tasks/${task.id}`));
  assert.equal(g.status, 200);
  assert.equal((await g.json()).data.title, 'V1');

  const u = await item.fetch(req(`/api/tasks/${task.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ status: 'done' }) }));
  assert.equal(u.status, 200);
  assert.equal((await u.json()).data.status, 'done');

  const l = await collection.fetch(req('/tasks?status=done'));
  assert.equal((await l.json()).data.count, 1);
});

test('vercel: malformed JSON, missing body, bad fields -> 400 in standard format', async () => {
  for (const body of ['{bad', undefined, JSON.stringify({ status: 'x' })]) {
    const r = await collection.fetch(req('/tasks', { method: 'POST', headers: json, body }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, 'BAD_REQUEST');
  }
});

test('vercel: preflight 204, 405, 404, bad id 400', async () => {
  const o = await collection.fetch(req('/tasks', { method: 'OPTIONS' }));
  assert.equal(o.status, 204);
  assert.match(o.headers.get('access-control-allow-methods'), /PATCH/);
  assert.equal((await collection.fetch(req('/tasks', { method: 'DELETE' }))).status, 405);
  assert.equal((await item.fetch(req('/tasks/3f2b8c1e-5d4a-4b7e-9c11-0a1b2c3d4e5f'))).status, 404);
  assert.equal((await item.fetch(req('/tasks/abc'))).status, 400);
  assert.equal((await item.fetch(req('/tasks/abc', { method: 'POST', headers: json, body: '{}' }))).status, 405);
});

// ---- RedisStore with a fake Upstash REST server ----
function fakeUpstash() {
  const hash = new Map();
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const cmd = JSON.parse(opts.body);
    calls.push({ url, auth: opts.headers.Authorization, cmd });
    const [op, , f, v] = cmd;
    let result = null;
    if (op === 'HSET') { hash.set(f, v); result = 1; }
    else if (op === 'HGET') result = hash.get(f) ?? null;
    else if (op === 'HGETALL') result = [...hash].flat();
    else return { ok: false, status: 400, json: async () => ({ error: 'ERR unknown command' }) };
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  return { fetchImpl, calls };
}

test('RedisStore: create/get/update/list via REST', async () => {
  const f = fakeUpstash();
  const s = new RedisStore({ url: 'https://r.example', token: 'tok', fetchImpl: f.fetchImpl });
  const a = await s.create({ title: 'A', status: 'todo' });
  await new Promise((r) => setTimeout(r, 5));
  const b = await s.create({ title: 'B', status: 'done' });
  assert.equal(f.calls[0].auth, 'Bearer tok');
  assert.deepEqual(await s.get(a.id), a);
  assert.equal(await s.get('nope'), null);
  assert.equal((await s.update(a.id, { status: 'done' })).status, 'done');
  assert.equal(await s.update('nope', { status: 'done' }), null);
  assert.deepEqual((await s.list()).map((t) => t.id), [b.id, a.id]);
  assert.equal((await s.list({ status: 'todo' })).length, 0);
  assert.equal((await s.list({ limit: 1 })).length, 1);
});

test('RedisStore: throws clear errors', async () => {
  const saved = { ...process.env };
  for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[k];
  assert.throws(() => new RedisStore(), /Redis is not configured/);
  Object.assign(process.env, saved);
  const bad = new RedisStore({ url: 'u', token: 't', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'WRONGPASS' }) }) });
  await assert.rejects(() => bad.get('x'), /WRONGPASS/);
});

test('RedisStore: reads KV_REST_API_* env names; getStore defaults to redis on Vercel', () => {
  const saved = { ...process.env };
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.KV_REST_API_URL = 'https://kv.example'; process.env.KV_REST_API_TOKEN = 'kvtok';
  assert.equal(new RedisStore().url, 'https://kv.example');
  setStore(null); delete process.env.STORE; process.env.VERCEL = '1';
  assert.equal(getStore().constructor.name, 'RedisStore');
  setStore(null);
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});
