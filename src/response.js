'use strict';
// Standardised HTTP responses + CORS headers shared by every function.

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

const ok = (data) => json(200, { data });
const created = (data, location) => json(201, { data }, location ? { Location: location } : {});
const noContent = () => ({ statusCode: 204, headers: { ...CORS_HEADERS }, body: '' });
const badRequest = (message, details) => json(400, { error: 'Bad Request', message, ...(details ? { details } : {}) });
const notFound = (message = 'Resource not found') => json(404, { error: 'Not Found', message });
const methodNotAllowed = (method) => json(405, { error: 'Method Not Allowed', message: `${method} is not supported on this route` });
const serverError = (message = 'Internal server error') => json(500, { error: 'Internal Server Error', message });

module.exports = { CORS_HEADERS, json, ok, created, noContent, badRequest, notFound, methodNotAllowed, serverError };
