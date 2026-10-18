'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryStore, DynamoStore } = require('../src/lib/store');

const input = { title: 'A', description: '', status: 'todo', priority: 'low', dueDate: null };

test('MemoryStore: create/get/update/list', async () => {
  const s = new MemoryStore();
  const a = await s.create(input);
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  assert.equal(a.createdAt, a.updatedAt);
  assert.deepEqual(await s.get(a.id), a);
  assert.equal(await s.get('missing'), null);

  await new Promise((r) => setTimeout(r, 5));
  const u = await s.update(a.id, { status: 'done' });
  assert.equal(u.status, 'done');
  assert.equal(u.title, 'A');
  assert.notEqual(u.updatedAt, a.updatedAt);
  assert.equal(await s.update('missing', { status: 'done' }), null);
});

test('MemoryStore: list filters by status, sorts newest first, applies limit', async () => {
  const s = new MemoryStore();
  const t1 = await s.create({ ...input, title: '1' });
  await new Promise((r) => setTimeout(r, 5));
  const t2 = await s.create({ ...input, title: '2', status: 'done' });
  await new Promise((r) => setTimeout(r, 5));
  const t3 = await s.create({ ...input, title: '3' });
  assert.deepEqual((await s.list()).map((t) => t.id), [t3.id, t2.id, t1.id]);
  assert.deepEqual((await s.list({ status: 'done' })).map((t) => t.id), [t2.id]);
  assert.equal((await s.list({ limit: 2 })).length, 2);
});

test('MemoryStore: returned objects are copies', async () => {
  const s = new MemoryStore();
  const a = await s.create(input);
  a.title = 'mutated';
  assert.equal((await s.get(a.id)).title, 'A');
});

// ---- DynamoStore with a fake client (no AWS needed) ----
function fakeDynamo() {
  const calls = [];
  const responses = [];
  class Cmd { constructor(p) { this.input = p; } }
  const commands = { Put: class Put extends Cmd {}, Get: class Get extends Cmd {}, Scan: class Scan extends Cmd {}, Update: class Update extends Cmd {} };
  const client = {
    async send(cmd) {
      calls.push({ type: cmd.constructor.name, input: cmd.input });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next || {};
    },
  };
  return { client, commands, calls, responses };
}

test('DynamoStore: create sends PutCommand with condition', async () => {
  const f = fakeDynamo();
  const s = new DynamoStore('T', f);
  const t = await s.create(input);
  assert.equal(f.calls[0].type, 'Put');
  assert.equal(f.calls[0].input.TableName, 'T');
  assert.equal(f.calls[0].input.ConditionExpression, 'attribute_not_exists(id)');
  assert.equal(f.calls[0].input.Item.id, t.id);
});

test('DynamoStore: get returns item or null', async () => {
  const f = fakeDynamo();
  const s = new DynamoStore('T', f);
  f.responses.push({ Item: { id: '1' } }, {});
  assert.deepEqual(await s.get('1'), { id: '1' });
  assert.equal(await s.get('2'), null);
  assert.deepEqual(f.calls[0].input.Key, { id: '1' });
});

test('DynamoStore: update builds expression using attribute names (status is reserved)', async () => {
  const f = fakeDynamo();
  const s = new DynamoStore('T', f);
  f.responses.push({ Attributes: { id: '1', status: 'done' } });
  const r = await s.update('1', { status: 'done', title: 'x' });
  assert.equal(r.status, 'done');
  const p = f.calls[0].input;
  assert.equal(p.ConditionExpression, 'attribute_exists(id)');
  assert.equal(p.ReturnValues, 'ALL_NEW');
  assert.match(p.UpdateExpression, /^SET #updatedAt = :updatedAt, #f0 = :v0, #f1 = :v1$/);
  assert.equal(p.ExpressionAttributeNames['#f0'], 'status');
  assert.equal(p.ExpressionAttributeValues[':v1'], 'x');
});

test('DynamoStore: update returns null when item is missing, rethrows other errors', async () => {
  const f = fakeDynamo();
  const s = new DynamoStore('T', f);
  const missing = new Error('cond'); missing.name = 'ConditionalCheckFailedException';
  f.responses.push(missing, new Error('boom'));
  assert.equal(await s.update('1', { title: 'x' }), null);
  await assert.rejects(() => s.update('1', { title: 'x' }), /boom/);
});

test('DynamoStore: list paginates, filters, sorts, limits', async () => {
  const f = fakeDynamo();
  const s = new DynamoStore('T', f);
  f.responses.push(
    { Items: [{ id: 'a', createdAt: '2024-01-01' }], LastEvaluatedKey: { id: 'a' } },
    { Items: [{ id: 'b', createdAt: '2024-02-01' }, { id: 'c', createdAt: '2024-03-01' }] }
  );
  const items = await s.list({ status: 'done', limit: 2 });
  assert.deepEqual(items.map((i) => i.id), ['c', 'b']);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].input.FilterExpression, '#s = :s');
  assert.deepEqual(f.calls[1].input.ExclusiveStartKey, { id: 'a' });
});

// ---- FileStore (used by serverless-offline) ----
const os = require('node:os');
const fsSync = require('node:fs');
const nodePath = require('node:path');
const { FileStore } = require('../src/lib/store');

function tmpFile() {
  const dir = fsSync.mkdtempSync(nodePath.join(os.tmpdir(), 'tasks-'));
  return nodePath.join(dir, 'nested', 'tasks.json');
}

test('FileStore: create/get/update/list persist to disk and are shared across instances', async () => {
  const file = tmpFile();
  const a = new FileStore(file);
  const b = new FileStore(file); // simulates a second serverless-offline worker
  const t = await a.create(input);
  assert.deepEqual(await b.get(t.id), t);
  const u = await b.update(t.id, { status: 'done' });
  assert.equal((await a.get(t.id)).status, 'done');
  assert.equal(u.status, 'done');
  assert.equal(await a.update('missing', { status: 'done' }), null);
  assert.equal(await a.get('missing'), null);
  assert.equal((await a.list({ status: 'done' })).length, 1);
  assert.equal((await a.list({ status: 'todo' })).length, 0);
});

test('FileStore: concurrent creates in one process are not lost', async () => {
  const s = new FileStore(tmpFile());
  await Promise.all(Array.from({ length: 20 }, (_, i) => s.create({ ...input, title: String(i) })));
  assert.equal((await s.list({ limit: 100 })).length, 20);
});

test('FileStore: recovers from a corrupt file', async () => {
  const file = tmpFile();
  fsSync.mkdirSync(nodePath.dirname(file), { recursive: true });
  fsSync.writeFileSync(file, '{corrupt');
  const s = new FileStore(file);
  assert.deepEqual(await s.list(), []);
  await s.create(input);
  assert.equal((await s.list()).length, 1);
});
