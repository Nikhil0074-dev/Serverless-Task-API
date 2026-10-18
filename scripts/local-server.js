'use strict';

/**
 * Zero-dependency local server that runs the real Lambda handlers using
 * API Gateway HTTP API (payload v2) style events. In-memory storage.
 *
 *   npm run dev            -> http://localhost:3000
 */

process.env.STORE = process.env.STORE || 'memory';

const http = require('node:http');
const { createTask, getTask, listTasks, updateTask } = require('../src/handlers/tasks');
const { error, noContent } = require('../src/lib/response');

const ROUTES = [
  { method: 'POST', re: /^\/tasks\/?$/, handler: createTask },
  { method: 'GET', re: /^\/tasks\/?$/, handler: listTasks },
  { method: 'GET', re: /^\/tasks\/([^/]+)\/?$/, handler: getTask, param: 'id' },
  { method: 'PATCH', re: /^\/tasks\/([^/]+)\/?$/, handler: updateTask, param: 'id' },
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, result) {
  res.writeHead(result.statusCode, result.headers);
  res.end(result.body);
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') return send(res, noContent());

      const matches = ROUTES.filter((r) => r.re.test(url.pathname));
      if (matches.length === 0) return send(res, error(404, 'Route not found'));
      const route = matches.find((r) => r.method === req.method);
      if (!route) return send(res, error(405, `Method ${req.method} not allowed`));

      const body = await readBody(req);
      const event = {
        version: '2.0',
        rawPath: url.pathname,
        requestContext: { http: { method: req.method, path: url.pathname } },
        headers: req.headers,
        queryStringParameters: url.search ? Object.fromEntries(url.searchParams) : undefined,
        pathParameters: route.param ? { [route.param]: decodeURIComponent(url.pathname.match(route.re)[1]) } : undefined,
        body: body || undefined,
        isBase64Encoded: false,
      };
      send(res, await route.handler(event));
    } catch (err) {
      console.error(err);
      send(res, error(500, 'Internal server error'));
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`Task API running at http://localhost:${port}`));
}

module.exports = { createServer };
