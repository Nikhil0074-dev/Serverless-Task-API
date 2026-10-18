'use strict';

/**
 * Standard HTTP responses with CORS headers.
 * Success body: { "data": ... }
 * Error body:   { "error": { "code", "message", "details"? } }
 */

const ERROR_CODES = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  500: 'INTERNAL_ERROR',
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function success(statusCode, data, extraHeaders) {
  return json(statusCode, { data }, extraHeaders);
}

function error(statusCode, message, details) {
  const err = { code: ERROR_CODES[statusCode] || 'ERROR', message };
  if (details !== undefined) err.details = details;
  return json(statusCode, { error: err });
}

function noContent() {
  return { statusCode: 204, headers: { ...corsHeaders() }, body: '' };
}

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = { corsHeaders, json, success, error, noContent, HttpError };
