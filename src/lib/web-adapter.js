'use strict';

/**
 * Lets the same Lambda-style handlers run as Vercel Functions
 * (Web Standard `fetch(request) => Response`).
 */

const { error, noContent } = require('./response');

async function toEvent(request, pathParameters) {
  const url = new URL(request.url);
  let body;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const text = await request.text(); // raw text, so bad JSON reaches OUR validation (standard 400)
    if (text) body = text;
  }
  return {
    version: '2.0',
    rawPath: url.pathname,
    requestContext: { http: { method: request.method, path: url.pathname } },
    headers: Object.fromEntries(request.headers),
    queryStringParameters: url.search ? Object.fromEntries(url.searchParams) : undefined,
    pathParameters,
    body,
    isBase64Encoded: false,
  };
}

function toResponse(result) {
  return new Response(result.statusCode === 204 ? null : result.body, {
    status: result.statusCode,
    headers: result.headers,
  });
}

/**
 * @param {Record<string, Function>} methods  e.g. { GET: listTasks, POST: createTask }
 * @param {{ idFromPath?: boolean }} [opts]   take the task id from the last URL segment
 */
function route(methods, { idFromPath = false } = {}) {
  return async function fetchHandler(request) {
    try {
      if (request.method === 'OPTIONS') return toResponse(noContent());
      const handler = methods[request.method];
      if (!handler) return toResponse(error(405, `Method ${request.method} not allowed`));

      let pathParameters;
      if (idFromPath) {
        const segments = new URL(request.url).pathname.split('/').filter(Boolean);
        pathParameters = { id: decodeURIComponent(segments[segments.length - 1] || '') };
      }
      return toResponse(await handler(await toEvent(request, pathParameters)));
    } catch (err) {
      console.error('Unhandled error:', err);
      return toResponse(error(500, 'Internal server error'));
    }
  };
}

module.exports = { route, toEvent, toResponse };
