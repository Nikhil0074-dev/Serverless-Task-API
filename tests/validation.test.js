'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCreate, validateUpdate, validateListQuery, isValidId } = require('../src/lib/validation');

const fields = (r) => r.errors.map((e) => e.field);

test('create: accepts minimal payload and applies defaults', () => {
  const r = validateCreate({ title: '  Buy milk ' });
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.value, { title: 'Buy milk', description: '', status: 'todo', priority: 'medium', dueDate: null });
});

test('create: accepts full payload', () => {
  const r = validateCreate({ title: 'T', description: 'd', status: 'done', priority: 'high', dueDate: '2030-02-28' });
  assert.equal(r.errors.length, 0);
  assert.equal(r.value.dueDate, '2030-02-28');
});

test('create: rejects non-object bodies', () => {
  for (const bad of [null, [], 'text', 42, true]) {
    assert.deepEqual(fields(validateCreate(bad)), ['body']);
  }
});

test('create: title is required, must be a non-empty string up to 200 chars', () => {
  assert.deepEqual(fields(validateCreate({})), ['title']);
  assert.deepEqual(fields(validateCreate({ title: 5 })), ['title']);
  assert.deepEqual(fields(validateCreate({ title: '   ' })), ['title']);
  assert.deepEqual(fields(validateCreate({ title: 'x'.repeat(201) })), ['title']);
  assert.equal(validateCreate({ title: 'x'.repeat(200) }).errors.length, 0);
});

test('create: rejects bad enum values, dates, types and unknown fields', () => {
  const r = validateCreate({
    title: 'ok', description: 5, status: 'nope', priority: 'urgent', dueDate: '2030-02-31', extra: 1,
  });
  assert.deepEqual(fields(r).sort(), ['description', 'dueDate', 'extra', 'priority', 'status']);
  assert.deepEqual(fields(validateCreate({ title: 'a', dueDate: '30-01-2030' })), ['dueDate']);
  assert.deepEqual(fields(validateCreate({ title: 'a', description: 'x'.repeat(2001) })), ['description']);
});

test('create: dueDate null is allowed', () => {
  assert.equal(validateCreate({ title: 'a', dueDate: null }).errors.length, 0);
});

test('update: partial payload ok, empty rejected, unknown rejected', () => {
  assert.deepEqual(validateUpdate({ status: 'done' }).value, { status: 'done' });
  assert.deepEqual(fields(validateUpdate({})), ['body']);
  assert.deepEqual(fields(validateUpdate({ id: 'x' })), ['id']);
  assert.deepEqual(fields(validateUpdate({ title: '' })), ['title']);
  assert.deepEqual(validateUpdate({ dueDate: null }).value, { dueDate: null });
});

test('list query: defaults, valid values, invalid values', () => {
  assert.deepEqual(validateListQuery({}).value, { limit: 50 });
  assert.deepEqual(validateListQuery({ status: 'done', limit: '10' }).value, { limit: 10, status: 'done' });
  assert.deepEqual(fields(validateListQuery({ status: 'x' })), ['status']);
  for (const bad of ['0', '101', 'abc', '-1', '1.5']) {
    assert.deepEqual(fields(validateListQuery({ limit: bad })), ['limit'], bad);
  }
});

test('isValidId', () => {
  assert.equal(isValidId('3f2b8c1e-5d4a-4b7e-9c11-0a1b2c3d4e5f'), true);
  assert.equal(isValidId('123'), false);
  assert.equal(isValidId(undefined), false);
});
