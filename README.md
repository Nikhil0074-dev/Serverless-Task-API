# Task 3 · Serverless Task API

A serverless REST API for task records (create / fetch / update / list / delete) on **AWS Lambda + API Gateway HTTP API + DynamoDB**, with request validation, CORS and standard HTTP status codes. Deployable with **Serverless Framework** (`serverless.yml`) or **AWS SAM** (`template.yaml`), and runnable **locally with zero setup**.

**Live API URL:** `https://<api-id>.execute-api.<region>.amazonaws.com` ← *replace after deploying*

## Features
- JSON endpoints with strict validation → `400` + per-field `details`
- CORS pre-flight (`OPTIONS`) and CORS headers on every response
- Cold-start-friendly: no heavy deps, lazy AWS SDK import, client reused across warm invocations, 256 MB / arm64, 10 s timeout
- Storage abstraction: in-memory (local/tests) ⇄ DynamoDB (auto when `TABLE_NAME` is set)
- Safe errors: internals logged to CloudWatch, never leaked to clients
- 14 automated tests (incl. real-socket end-to-end)

## Tech stack
Node.js 20 · AWS Lambda · API Gateway (HTTP API) · DynamoDB (on-demand) · Serverless Framework v3 / AWS SAM · `node:test`

## Project layout
```
src/handler.js      routing + orchestration (Lambda entry point)
src/validation.js   payload validation
src/store.js        MemoryStore + DynamoStore
src/response.js     status helpers + CORS headers
local-server.js     local runner (alternative to serverless-offline)
serverless.yml      IaC (Serverless Framework)    template.yaml   IaC (AWS SAM)
tests/api.test.js
```

## Run locally (no AWS needed)
```bash
npm test          # 14 tests
npm start         # http://localhost:3000
```

## API reference
Base URL: `http://localhost:3000` locally, or your API Gateway URL.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/tasks` | `{title, description?, status?, priority?, dueDate?}` | **201** + `Location` | 400 |
| GET | `/tasks?status=todo\|in_progress\|done` | – | 200 `{data, count}` | 400 |
| GET | `/tasks/{id}` | – | 200 | 400 (bad id) · 404 |
| PUT / PATCH | `/tasks/{id}` | any subset of fields | 200 | 400 · 404 |
| DELETE | `/tasks/{id}` | – | 204 | 404 |
| GET | `/health` | – | 200 | – |

**Fields:** `title` (required, ≤120 chars) · `description` (≤1000) · `status` ∈ `todo, in_progress, done` (default `todo`) · `priority` ∈ `low, medium, high` (default `medium`) · `dueDate` `YYYY-MM-DD` or `null`.

### curl examples
```bash
API=http://localhost:3000

# Create → 201
curl -i -X POST $API/tasks -H 'Content-Type: application/json' \
  -d '{"title":"Finish Task 3","priority":"high","dueDate":"2026-11-01"}'

# List / filter → 200
curl $API/tasks
curl "$API/tasks?status=todo"

# Fetch one → 200  (use the id from the create response)
curl $API/tasks/<id>

# Update → 200
curl -X PATCH $API/tasks/<id> -H 'Content-Type: application/json' -d '{"status":"done"}'

# Delete → 204
curl -i -X DELETE $API/tasks/<id>

# Validation failure → 400
curl -i -X POST $API/tasks -H 'Content-Type: application/json' -d '{"title":"","status":"finished"}'
# {"error":"Bad Request","message":"Validation failed","details":[{"field":"title",...},{"field":"status",...}]}

# Malformed JSON → 400
curl -i -X POST $API/tasks -H 'Content-Type: application/json' -d '{"title":'

# CORS pre-flight → 204 with Access-Control-* headers
curl -i -X OPTIONS $API/tasks -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST'
```

**Postman:** import the curl commands (*Import → Raw text*), set a `{{api}}` variable.

**Browser CORS check** (run from any other site's DevTools console):
```js
fetch('https://<api>/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'from browser'})}).then(r=>r.json()).then(console.log)
```

## Deploy

### Serverless Framework
```bash
npm install
aws configure                       # IAM user with Lambda/APIGW/DynamoDB/CloudFormation rights (never commit keys)
npx serverless deploy --stage dev   # prints the endpoint URL
npx serverless logs -f api -t       # tail CloudWatch logs
npx serverless remove               # delete everything (stay at $0)
```
Offline emulation: `npx serverless offline` (plugin included).

### AWS SAM
```bash
sam build && sam deploy --guided    # note the ApiUrl output
sam delete
```

### Vercel / Netlify alternative
The handler is framework-agnostic: wrap `handler(event)` in a function file (`api/tasks.js`) and map `req` → event as done in `local-server.js`. Free tiers of both support this.

## Cost & free-tier notes
Lambda free tier: 1 M requests + 400 k GB-s / month · DynamoDB on-demand: pay per request (cents at this scale) · API Gateway HTTP API: 1 M calls free for 12 months. **Set an AWS Budget alert** and run `serverless remove` when done.

## Acceptance criteria
| Criterion | Evidence |
|---|---|
| Cold start without timeouts | 10 s timeout, lazy imports, reused client; CloudWatch `Init Duration` screenshot |
| CORS for browsers | `OPTIONS` + headers on all responses (`CORS` test) |
| Malformed payload → 400 | validation tests incl. bad JSON, wrong types, unknown fields |

## Screenshots
![curl create](docs/screenshots/t3-curl-create.png)
![AWS console](docs/screenshots/t3-aws-console.png)
