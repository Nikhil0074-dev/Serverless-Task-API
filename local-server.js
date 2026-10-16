'use strict';
// Tiny local runner that adapts Node's http module to the Lambda event shape so the SAME
// handler can be demoed with curl/Postman without any cloud account ("serverless-offline" alternative).
const http = require('node:http');
const { handler } = require('./src/handler');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, httpRes) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const event = {
      version: '2.0',
      rawPath: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
      headers: req.headers,
      requestContext: { http: { method: req.method } },
      body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined,
      isBase64Encoded: false,
    };
    const result = await handler(event);
    httpRes.writeHead(result.statusCode, result.headers);
    httpRes.end(result.body);
    console.log(`${req.method} ${url.pathname} -> ${result.statusCode}`);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Task API running at http://localhost:${PORT}  (try GET /health)`));
}
module.exports = { server };
