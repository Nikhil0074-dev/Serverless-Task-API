# Serverless Task API

A small REST API for task records, built on **AWS Lambda + API Gateway (HTTP API) + DynamoDB**, deployed with the **Serverless Framework**. It also runs locally with no AWS account.

- Runtime: Node.js 20
- Deploy to **AWS** (Serverless Framework) or **Vercel**; same handler code for both
- Endpoints: create, fetch, list, update
- Validation, CORS, standard HTTP status codes, JSON errors
- 43 automated tests (no AWS or Vercel account needed)

## Project layout

```
serverless.yml            AWS infrastructure: functions, routes, CORS, DynamoDB table, IAM
vercel.json               Vercel config: /tasks rewrites
api/tasks/index.mjs       Vercel Function: POST and GET /tasks
api/tasks/[id].mjs        Vercel Function: GET and PATCH /tasks/{id}
src/handlers/tasks.js     Lambda handlers (create, get, list, update)
src/lib/validation.js     Request validation rules
src/lib/response.js       Standard responses + CORS headers
src/lib/store.js          Storage: Memory (tests), File (offline), DynamoDB (AWS), Redis (Vercel)
src/lib/redis-store.js    Upstash Redis store (plain HTTPS, no SDK)
src/lib/web-adapter.js    Runs the Lambda-style handlers as Vercel Web Standard functions
scripts/local-server.js   Zero-dependency local server (runs the same handlers)
tests/                    Unit + HTTP tests (node:test)
```

## Quick start (local, no AWS)

Requires Node.js 20 or newer.

```bash
npm install
npm test            # run all tests
```

**Option A: simple local server (fastest, no install needed to run)**

```bash
npm run dev         # http://localhost:3000, data kept in memory
```

**Option B: serverless-offline (emulates API Gateway + Lambda)**

```bash
npm run offline     # http://localhost:3000, data saved to .data/tasks.json
```

Both use the same handler code.

## Deploy to AWS

1. Create an AWS account and an IAM user with deploy rights. Run `aws configure` (or set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`).
2. Deploy:
   ```bash
   npm install
   npx serverless deploy --stage dev --region us-east-1
   ```
3. The output shows `ApiBaseUrl` and `HttpApiUrl`. Use that URL as `BASE` in the examples below.
4. Remove everything when finished (avoids any cost):
   ```bash
   npx serverless remove --stage dev
   ```

Cost: Lambda, API Gateway and DynamoDB on-demand all have free tiers. A demo like this normally costs nothing.

Note: this project uses Serverless Framework **v3** (free for everyone). v4 needs a login and a licence for larger companies.

## Deploy to Vercel

Vercel has no built-in database, and its file system is read-only and temporary. So this version stores tasks in **Upstash Redis** (free tier, added from the Vercel Marketplace). Without it, deploy still works but every request that touches data returns `500`.

### Option 1: dashboard (easiest)

1. Push this project to a GitHub repository.
2. Go to https://vercel.com/new and import the repository.
3. Framework Preset: **Other**. Leave Build Command and Output Directory empty. Click **Deploy**.
4. Open your project, go to the **Storage** tab, choose **Upstash Redis** from the Marketplace, create a free database and **connect it to this project**. This adds the Redis environment variables automatically.
5. Go to **Deployments**, open the latest one, and **Redeploy** (environment variables only apply to new deployments).
6. Your base URL is `https://YOUR-PROJECT.vercel.app`. Test it:
   ```bash
   BASE=https://YOUR-PROJECT.vercel.app
   curl -i -X POST $BASE/tasks -H "Content-Type: application/json" -d '{"title":"Hello Vercel"}'
   ```

### Option 2: CLI

```bash
npm install -g vercel
vercel login
vercel            # first deploy (preview). Answer the prompts; framework = Other
vercel --prod     # production deploy
```

Then do steps 4 and 5 above in the dashboard (add Upstash Redis, redeploy with `vercel --prod`).

### Settings you may need

| Setting | Where | Why |
|---|---|---|
| `CORS_ORIGIN` | Project, Settings, Environment Variables | Set to your website, e.g. `https://app.example.com`. Default is `*` (any site). |
| Deployment Protection | Project, Settings, Deployment Protection | Preview URLs can be login-protected, which makes curl return `401`. Test on your production URL, or turn protection off for a demo. |

### How it works on Vercel

- Each file in `api/` becomes a function. They call the same handlers as the AWS version.
- `vercel.json` rewrites `/tasks` and `/tasks/{id}` to `/api/tasks...`, so the URLs match the docs above. `/api/tasks` works too.
- On Vercel (`VERCEL` env var is set) storage defaults to Redis. Force it anywhere with `STORE=redis`.
- Redis variables supported: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

### Vercel-specific limits

- Updates are read then write (not atomic). Two updates to the same task at the same instant: last one wins.
- `GET /tasks` reads the whole Redis hash. Fine for a demo, not for thousands of tasks.
- Cold starts on Vercel depend on region and plan, and I could not measure them here.

## Data model

| Field | Type | Rules | Default |
|---|---|---|---|
| `id` | string (UUID) | set by server | generated |
| `title` | string | required, 1 to 200 chars | none |
| `description` | string | up to 2000 chars | `""` |
| `status` | string | `todo`, `in_progress`, `done` | `todo` |
| `priority` | string | `low`, `medium`, `high` | `medium` |
| `dueDate` | string or null | `YYYY-MM-DD`, must be a real date | `null` |
| `createdAt`, `updatedAt` | string (ISO time) | set by server | generated |

## API reference

Set a base URL first:

```bash
BASE=http://localhost:3000          # local
# BASE=https://abc123.execute-api.us-east-1.amazonaws.com   # after deploy
```

Success responses look like `{ "data": ... }`.
Error responses look like `{ "error": { "code", "message", "details" } }`.

### POST /tasks: create a task  (201)

```bash
curl -i -X POST $BASE/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Write README","priority":"high","dueDate":"2030-12-31"}'
```

```json
{
  "data": {
    "id": "edf60ebe-d80c-41d7-9abc-2a9697133973",
    "title": "Write README",
    "description": "",
    "status": "todo",
    "priority": "high",
    "dueDate": "2030-12-31",
    "createdAt": "2026-10-18T13:21:35.898Z",
    "updatedAt": "2026-10-18T13:21:35.898Z"
  }
}
```

The response also has a `Location: /tasks/{id}` header.

### GET /tasks/{id}: fetch one task  (200)

```bash
curl -i $BASE/tasks/edf60ebe-d80c-41d7-9abc-2a9697133973
```

### GET /tasks: list tasks  (200)

Newest first. Optional query parameters: `status` (one of the three statuses) and `limit` (1 to 100, default 50).

```bash
curl "$BASE/tasks?status=done&limit=10"
```

```json
{ "data": { "items": [ ... ], "count": 1 } }
```

### PATCH /tasks/{id}: update a task  (200)

Send only the fields you want to change (at least one). Set `dueDate` to `null` to clear it.

```bash
curl -i -X PATCH $BASE/tasks/edf60ebe-d80c-41d7-9abc-2a9697133973 \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

### CORS preflight

```bash
curl -i -X OPTIONS $BASE/tasks \
  -H "Origin: http://example.com" \
  -H "Access-Control-Request-Method: POST"
```

### Status codes

| Code | When |
|---|---|
| 200 | Fetched or updated OK |
| 201 | Created |
| 204 | CORS preflight |
| 400 | Bad JSON, missing body, failed validation, invalid id, invalid query |
| 404 | Task not found |
| 413 | Body larger than 10 KB |
| 500 | Unexpected server error (details are logged, never returned) |

### Example 400 error

```bash
curl -i -X POST $BASE/tasks -H "Content-Type: application/json" -d '{"status":"nope"}'
```

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Validation failed",
    "details": [
      { "field": "title", "message": "is required" },
      { "field": "status", "message": "must be one of: todo, in_progress, done" }
    ]
  }
}
```

### Postman

1. Create a collection variable `BASE` set to your base URL.
2. Add requests for the four endpoints above, using `{{BASE}}/tasks`.
3. For POST and PATCH, set Body to `raw` / `JSON` and paste the example bodies.

## How the acceptance criteria are met

**Cold starts**
- Handlers load in about 6 ms. The DynamoDB client is created once per container, outside the handler code path, and reused on warm calls. The SDK comes from the Lambda runtime, so the bundle is tiny (about 10 KB of code).
- Memory is 256 MB (more memory gives more CPU, so faster starts) and timeout is 10 s. That is far below the API Gateway limit of 30 s, so a slow first call finishes instead of timing out.
- To remove cold starts entirely you would need provisioned concurrency. That costs money and is not enabled here.

**CORS**
- API Gateway answers preflight (`OPTIONS`) requests from the `httpApi.cors` block in `serverless.yml`.
- Every Lambda response, including errors, also carries `Access-Control-Allow-Origin`, so browsers can read error bodies too.
- Default origin is `*`. For production, set `custom.corsOrigin` in `serverless.yml` to your site, for example `https://app.example.com`.

**Validation**
- Bad JSON, wrong types, unknown fields, bad enum values, impossible dates (like `2030-02-31`), empty updates and bad ids all return `400` with per-field details.

## Known limits

- No authentication. Anyone with the URL can read and write tasks. Add an API Gateway authorizer (JWT) before real use.
- `GET /tasks` uses a DynamoDB Scan with no pagination cursor. Fine for a demo, slow and costly on large tables. Use an index and Query for real data.
- No delete endpoint (not in the requirements).
- The local file store (`npm run offline`) is for one machine only.

## Tests

```bash
npm test
```

- `validation.test.js`: every validation rule
- `response.test.js`: response shape and CORS headers
- `store.test.js`: memory, file and DynamoDB stores (DynamoDB uses a fake client, so no AWS needed)
- `handlers.test.js`: each endpoint, including all 400, 404, 413, 500 cases
- `server.test.js`: full HTTP lifecycle and CORS preflight against the local server
- `vercel.test.js`: the Vercel functions called with real `Request` objects, plus the Redis store against a fake Upstash server
