'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { success, error, noContent, corsHeaders } = require('../src/lib/response');

test('success wraps data and includes CORS + JSON headers', () => {
  const r = success(201, { a: 1 }, { Location: '/x' });
  assert.equal(r.statusCode, 201);
  assert.deepEqual(JSON.parse(r.body), { data: { a: 1 } });
  assert.match(r.headers['Content-Type'], /application\/json/);
  assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(r.headers.Location, '/x');
});

test('error has code, message and optional details', () => {
  const r = error(400, 'bad', [{ field: 'x' }]);
  assert.deepEqual(JSON.parse(r.body), { error: { code: 'BAD_REQUEST', message: 'bad', details: [{ field: 'x' }] } });
  assert.equal(JSON.parse(error(404, 'nf').body).error.details, undefined);
  assert.equal(JSON.parse(error(500, 'x').body).error.code, 'INTERNAL_ERROR');
});

test('CORS origin is configurable', () => {
  process.env.CORS_ORIGIN = 'https://app.example.com';
  assert.equal(corsHeaders()['Access-Control-Allow-Origin'], 'https://app.example.com');
  delete process.env.CORS_ORIGIN;
});

test('noContent returns 204 with CORS headers', () => {
  const r = noContent();
  assert.equal(r.statusCode, 204);
  assert.ok(r.headers['Access-Control-Allow-Methods'].includes('PATCH'));
});
