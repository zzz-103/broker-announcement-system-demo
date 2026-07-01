# API_CONTRACT.md

This document defines the integration contract. It does not implement code.

## Service Boundary

- Browsers call only the Next.js BFF.
- Next.js owns login, session, browser-facing roles, and CSRF protection.
- Roles are `admin` and `user`.
- Python FastAPI is an internal service and must listen on an internal address by default.
- Next.js calls Python with a short-lived internal JWT.
- Python reads published dataset versions, validates CSV data, exposes read-only data APIs, and later may own controlled task orchestration.

## Canonical Internal API Paths

The canonical Python API paths are:

- `GET /health`
- `GET /internal/data/meta`
- `GET /internal/data/options`
- `GET /internal/data/announcements`
- `GET /internal/analytics/overview`
- `GET /internal/admin/tasks`
- `GET /internal/admin/tasks/{taskId}`
- `POST /internal/admin/tasks/validate`
- `POST /internal/admin/tasks`
- `POST /internal/admin/tasks/{taskId}/cancel`
- `GET /internal/admin/tasks/{taskId}/logs`

Do not introduce or use these older paths:

- `/internal/data/version`
- `/internal/announcements`

## Internal JWT

Header:

```http
Authorization: Bearer <internal-jwt>
```

Claims:

```json
{
  "iss": "broker-announcement-next-bff",
  "aud": "broker-announcement-python-api",
  "sub": "user_123",
  "role": "admin",
  "sid": "session_id",
  "iat": 1782800000,
  "exp": 1782800300,
  "jti": "uuid"
}
```

Rules:

- Token lifetime should be 60 to 300 seconds.
- Python must validate signature, `iss`, `aud`, `exp`, and `role`.
- Allowed roles are `user` and `admin`.
- Read-only internal APIs allow `user` and `admin`.
- Future admin APIs must require `admin`.
- JWT secrets must stay in server-side environment variables and must never use `NEXT_PUBLIC_*`.
- There is no HTTP endpoint for minting internal JWTs.

## Stable `record_id`

`record_id` must not use CSV array indexes, pagination indexes, or suffixes such as `/0`.

For each CSV row, build a stable identity string from these fields:

- `broker_folder`
- `markdown_file`
- `publish_date`
- `announcement_stage`
- `project_name`
- `winning_supplier`
- `winning_amount_yuan`

Normalization is fixed:

- `null` becomes an empty string.
- Strings are trimmed.
- Consecutive whitespace is collapsed.
- Amounts are converted to a fixed decimal string.
- Dates are converted to `YYYY-MM-DD`.
- Fields are joined with a fixed separator that should not conflict with normal text. The current backend implementation uses ASCII unit separator `\x1f`.
- The final `record_id` is the SHA-256 hex digest of the joined normalized string.

The same row data loaded repeatedly must produce the same `record_id`. Changing supplier or amount must produce a different `record_id`.

## Domain Fields

The raw CSV does not contain a `domain` field.

The current frontend derives domain in `frontend/src/lib/announcement-data.ts` from `project_name`, `project_subcategory`, and `procurement_category` using local keyword rules. This phase does not migrate that frontend classification logic into Python.

Contract choice for this phase:

- Python does not return `domain`, `domains`, `domainDistribution`, or `derivedDomain`.
- Query and aggregation APIs use `procurementCategory` and `projectSubcategory`.
- A later phase may add `derivedDomain` only after the transformation rules are explicitly ported and tested.

## Error Response

All business errors use this shape:

```json
{
  "error": {
    "code": "DATASET_UNAVAILABLE",
    "message": "Published dataset is unavailable",
    "requestId": "uuid",
    "details": {}
  }
}
```

Status codes:

- `400 INVALID_ARGUMENT`
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `422 DATASET_VALIDATION_FAILED`
- `500 INTERNAL_ERROR`
- `503 DATASET_UNAVAILABLE`
- `503 SERVICE_UNAVAILABLE`
- `422 INVALID_TASK_TYPE`
- `422 INVALID_TASK_PARAMETERS`
- `422 UNKNOWN_BROKER`
- `403 DESTRUCTIVE_TASK_DISABLED`
- `422 DESTRUCTIVE_CONFIRMATION_REQUIRED`
- `404 TASK_NOT_FOUND`
- `422 INVALID_TASK_TRANSITION`
- `500 TASK_DATABASE_ERROR`
- `503 TASK_EXECUTION_DISABLED`
- `503 TASK_WORKER_DISABLED`
- `503 TASK_EXECUTION_MODE_UNSUPPORTED`
- `409 TASK_ALREADY_RUNNING`
- `409 TASK_ALREADY_FINISHED`
- `400 INVALID_IDEMPOTENCY_KEY`
- `503 TASK_LOG_UNAVAILABLE`

Task records may also store internal `errorCode` values such as `TASK_CANCEL_REQUESTED` and `WORKER_RESTARTED`; these are task audit/status fields, not public HTTP response codes.

Responses must not include Python tracebacks, absolute paths, environment variables, secrets, raw Authorization headers, or server filesystem details.

## Data Meta

```http
GET /internal/data/meta
```

Response:

```json
{
  "version": "20260630T020000Z_ab12cd34",
  "csvSha256": "hex",
  "rowCount": 644,
  "validRowCount": 644,
  "publishedAt": "2026-06-30T02:00:00Z",
  "dateMin": "2026-01-01",
  "dateMax": "2026-06-29",
  "brokerCount": 18,
  "dataQuality": {
    "invalidRowCount": 0,
    "missingRequiredColumns": [],
    "missingValueCounts": {
      "publish_date": 89
    },
    "duplicateRecordIdCount": 0,
    "warnings": []
  }
}
```

The meta response must not return absolute paths, relative paths, or `internal://` paths.

## Filter Options

```http
GET /internal/data/options
```

Response:

```json
{
  "version": "20260630T020000Z_ab12cd34",
  "brokers": [
    {"value": "caitong_securities", "label": "财通证券", "count": 33}
  ],
  "stages": [
    {"value": "结果公示", "label": "结果公示", "count": 271}
  ],
  "procurementCategories": [],
  "projectSubcategories": [],
  "procurementMethods": [],
  "missingCount": {
    "brokers": 0,
    "stages": 5,
    "procurementCategories": 5,
    "projectSubcategories": 5,
    "procurementMethods": 194
  }
}
```

Empty strings must not be returned as normal filter options.

## Announcements Query

```http
GET /internal/data/announcements?page=1&pageSize=20&brokerFolder=caitong_securities&stage=结果公示&keyword=系统&sortBy=publishDate&sortOrder=desc
```

Supported query parameters:

- `page`
- `pageSize`, default `20`, max `100`
- `brokerFolder`
- `brokerName`
- `stage`
- `procurementCategory`
- `projectSubcategory`
- `procurementMethod`
- `keyword`, searching `project_name` and `winning_supplier`
- `dateFrom`
- `dateTo`
- `sortBy`, whitelist only
- `sortOrder`, `asc` or `desc`

Response:

```json
{
  "version": "20260630T020000Z_ab12cd34",
  "page": 1,
  "pageSize": 20,
  "total": 644,
  "items": [
    {
      "recordId": "sha256hex",
      "brokerFolder": "caitong_securities",
      "brokerName": "财通证券",
      "markdownFile": "063f439230bc970e85fc7213.md",
      "publishDate": "2026-06-20",
      "announcementStage": "结果公示",
      "procurementCategory": "IT软硬件",
      "projectSubcategory": "数据平台",
      "projectName": "项目名称",
      "procurementMethod": "公开招标",
      "winningSupplier": "供应商名称",
      "winningAmountYuan": 123456.78
    }
  ]
}
```

Do not return:

- `document_sha1`
- `raw_json_path`
- `processed_at`
- real filesystem paths

Rows are not deduplicated by `markdown_file`.

## Analytics Overview

```http
GET /internal/analytics/overview
```

Response:

```json
{
  "version": "20260630T020000Z_ab12cd34",
  "totalRecords": 644,
  "brokerCount": 18,
  "stageDistribution": [{"value": "结果公示", "count": 271}],
  "procurementCategoryDistribution": [],
  "projectSubcategoryDistribution": [],
  "procurementMethodDistribution": [],
  "monthlyTrend": [{"month": "2026-06", "count": 120}],
  "disclosedWinningAmount": {
    "recordCount": 56,
    "totalYuan": 12345678.9,
    "averageYuan": 220458.55
  },
  "amountSampleCount": 56,
  "amountCoverageRate": 0.0869,
  "missingDateRate": 0.1382,
  "missingMethodRate": 0.3012
}
```

Amount statistics are only for records with disclosed valid amounts.

## Future AI Summary

`/api/ai-analysis` remains a Next.js BFF path for browser compatibility. In a later phase, CSV reading, aggregation, prompt construction, LLM calls, and result persistence should move to Python. This phase does not implement AI summary migration.

## Admin Task Metadata

Phase B2A adds formal task creation with a single dry-run worker. It still does not execute crawler scripts, extraction scripts, shell commands, or LLM calls.

Execution modes:

- `disabled`: task creation returns `503 TASK_EXECUTION_DISABLED` and no task record is created.
- `dry_run`: task creation is allowed and a single in-process dry-run worker advances task metadata and logs.
- `live`: executes a server-built argv with a controlled subprocess runner. It requires both `TASK_EXECUTION_MODE=live` and `TASK_LIVE_EXECUTION_ENABLED=true`; otherwise creation returns `503 LIVE_EXECUTION_DISABLED`.

`TASK_WORKER_ENABLED=false` disables the worker and task creation returns `503 TASK_WORKER_DISABLED` so tasks cannot remain pending forever.

Task types:

- `crawl`
- `extract`
- `pipeline`

Task statuses:

- `pending`
- `running`
- `succeeded`
- `failed`
- `interrupted`
- `cancelled`

Task phases:

- `validation`
- `crawler`
- `extraction`
- `publishing`
- `completed`

Allowed transitions:

- `pending -> running`
- `pending -> cancelled`
- `running -> succeeded`
- `running -> failed`
- `running -> interrupted`
- `running -> cancelled`

All other transitions are rejected with `INVALID_TASK_TRANSITION`.

### List Tasks

```http
GET /internal/admin/tasks?page=1&pageSize=20&status=pending&taskType=crawl&requestedBy=user_123
```

Admin only.

Response:

```json
{
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "items": [
    {
      "taskId": "task_uuid",
      "taskType": "crawl",
      "status": "pending",
      "phase": "validation",
      "requestedBy": "user_123",
      "requestedRole": "admin",
      "createdAt": "2026-06-30T03:00:00Z",
      "startedAt": null,
      "finishedAt": null,
      "exitCode": null,
      "errorCode": null,
      "errorMessage": null,
      "datasetVersionBefore": "20260630T023711Z_5a74ed0a",
      "datasetVersionAfter": null,
      "cancelRequested": false,
      "updatedAt": "2026-06-30T03:00:00Z"
    }
  ]
}
```

The response must not include `pid`, real `log_path`, absolute paths, secrets, or executable internal command arrays.

### Task Detail

```http
GET /internal/admin/tasks/{taskId}
```

Admin only. Returns the safe task summary plus filtered audit events. Event metadata is whitelist-filtered and must not contain secrets, Authorization headers, JWTs, raw environment variables, or absolute paths.

### Validate Task Request

```http
POST /internal/admin/tasks/validate
```

Admin only. This endpoint validates parameters and returns a logical command preview. It does not create a task and does not execute anything.

Request:

```json
{
  "taskType": "pipeline",
  "parameters": {
    "brokers": ["ctsec"],
    "crawler": {
      "maxPagesPerBroker": 1,
      "maxLinksPerBroker": 10
    },
    "llm": {
      "llmWorkers": 2,
      "llmTimeoutSeconds": 120
    }
  }
}
```

Response:

```json
{
  "valid": true,
  "taskType": "pipeline",
  "normalizedParameters": {},
  "destructive": false,
  "logicalCommandPreview": [
    "python",
    "modules/run_crawler_then_llm.py",
    "--brokers",
    "ctsec"
  ]
}
```

`logicalCommandPreview` must not include server absolute paths, secrets, environment variables, or shell strings.

Dangerous parameters are disabled unless `ALLOW_DESTRUCTIVE_TASKS=true`. Dangerous parameters include:

- `force`
- `overwrite`
- `fullRefresh`
- `llmFullRefresh`
- `forceCrawl`

Even when destructive tasks are enabled, requests must include `destructiveOperationConfirmed=true`.

### Create Task

```http
POST /internal/admin/tasks
Idempotency-Key: user-action-uuid
```

Admin only. In B2A this creates metadata for one dry-run task and notifies the single worker. It returns `202` for a new task.

Request:

```json
{
  "taskType": "pipeline",
  "parameters": {
    "brokers": ["ctsec"]
  },
  "destructiveOperationConfirmed": false
}
```

Response:

```json
{
  "task": {
    "taskId": "task_uuid",
    "taskType": "pipeline",
    "status": "pending",
    "phase": "validation",
    "isActive": true,
    "logicalCommandPreview": ["python", "modules/run_crawler_then_llm.py", "--brokers", "ctsec"],
    "datasetVersionBefore": "20260630T023711Z_5a74ed0a",
    "datasetVersionAfter": null,
    "cancelRequested": false
  },
  "idempotent": false
}
```

`Idempotency-Key` is optional but recommended. It must be at most 128 characters and contain only letters, digits, `.`, `_`, `:`, or `-`. The same `requested_by + Idempotency-Key` returns the original task with `200` and does not create a duplicate, even if the original task is still pending or running. Different users may use the same key independently.

Only one pending or running task is allowed. A second non-idempotent create request returns `409 TASK_ALREADY_RUNNING`.

The API must not return real script paths, environment variables, internal argv arrays, `pid`, or `log_path`.

### Cancel Task

```http
POST /internal/admin/tasks/{taskId}/cancel
```

Admin only.

- Pending tasks are marked `cancel_requested=true`, transition to `cancelled`, set `finished_at`, and write a cancel event.
- Running tasks are marked `cancel_requested=true`; the dry-run worker later transitions them to `cancelled` at a check point.
- Repeated cancellation of a running task is idempotent and does not flood events.
- Terminal tasks return `409 TASK_ALREADY_FINISHED`.

### Task Logs

```http
GET /internal/admin/tasks/{taskId}/logs?tailLines=200
```

Admin only. Logs are addressed only by `taskId`; no file path is accepted from clients. `tailLines` is capped by `TASK_LOG_TAIL_MAX_LINES`.

Response:

```json
{
  "taskId": "task_uuid",
  "lines": ["Dry-run phase completed: validation"],
  "truncated": false
}
```

Logs must be sanitized on write and again on read. They must not expose Authorization headers, bearer tokens, JWTs, API keys, passwords, secrets, database credentials, absolute paths, `log_path`, or environment variables.

### Dry-Run And Live Worker Semantics

The FastAPI lifespan starts at most one dry-run worker loop. The worker atomically claims one pending task by transitioning `pending -> running` in the database, then advances phases:

- `crawl`: `validation`, `crawler`, `completed`
- `extract`: `validation`, `extraction`, `completed`
- `pipeline`: `validation`, `crawler`, `extraction`, `publishing`, `completed`

Each phase updates the task phase, writes an event, writes a safe log line, waits `TASK_DRY_RUN_STEP_SECONDS`, and checks `cancel_requested`.

Successful dry-runs transition `running -> succeeded`, set `exit_code=0`, keep `pid=null`, and set `datasetVersionAfter` equal to `datasetVersionBefore`. They must not modify the source CSV, `current.json`, or create a new published version.

Live mode uses the same single worker and atomic claim rule, but it does not simulate internal crawler/extraction phases. It runs one controlled child process:

- `crawl`: execution phase uses `crawler`, then `completed`; success does not publish a structured dataset version.
- `extract`: execution phase uses `extraction`; exit code `0` enters `publishing`, validates the structured CSV, then `completed`.
- `pipeline`: execution phase uses `execution`; exit code `0` enters `publishing`, validates the structured CSV, then `completed`.

Live command construction rules:

- Commands are argv arrays only; shell strings are forbidden.
- The Python executable is server configured by `TASK_ALLOWED_PYTHON_EXECUTABLE` or falls back to the current Python executable.
- Script paths are fixed by task type and resolved under the backend root.
- `cwd` is fixed to the backend root.
- Environment variables are built from a server-side allowlist and never from HTTP input.
- HTTP requests cannot provide script paths, cwd, argv, Python executable, output paths, or environment variables.
- Public API responses must not expose pid, process create time, absolute argv paths, cwd, env, log path, or secrets.

Live exit handling:

- Exit code `0` on `crawl`: task succeeds and `datasetVersionAfter` equals `datasetVersionBefore`.
- Exit code `0` on `extract` or `pipeline`: validate and publish the structured CSV if its SHA-256 changed.
- Non-zero exit: task fails with `PROCESS_EXIT_NONZERO`; no dataset publish occurs.
- Start failure: task fails with `PROCESS_START_FAILED`; absolute paths and raw exceptions are not returned to API clients.
- Cancellation: no dataset publish occurs; the worker terminates the process tree before marking the task `cancelled`.

Dataset publishing after successful `extract` or `pipeline`:

- The existing CSV validator and published dataset repository are reused.
- If validation fails, the task fails with `DATASET_VALIDATION_FAILED` and `current.json` remains unchanged.
- If the CSV SHA-256 is unchanged, no duplicate version directory is created and the task still succeeds.
- If the CSV SHA-256 changed, a new version directory and metadata are created and `current.json` is atomically updated.
- Incomplete temporary publish directories are cleaned up on publish failure.

On service startup, before claiming new tasks, existing `running` tasks are marked `interrupted` with `WORKER_RESTARTED`; existing `pending` tasks are marked `cancelled` with `WORKER_RESTARTED`. Old pending tasks are not automatically resumed.

Run B2A with a single process and a single worker only. Do not use multiple uvicorn workers. Avoid `--reload` while a dry-run task is active because reload intentionally restarts the worker and recovery will interrupt/cancel in-flight tasks.

## CSV Field Mapping

| CSV field | API field | Returned to normal users |
| --- | --- | --- |
| `broker_folder` | `brokerFolder` | Yes |
| `broker_name` | `brokerName` | Yes |
| `markdown_file` | `markdownFile` | Yes as source identifier, not as unique record ID |
| `document_sha1` | none | No |
| `processed_at` | none | No |
| `raw_json_path` | none | No |
| `publish_date` | `publishDate` | Yes, nullable |
| `announcement_stage` | `announcementStage` | Yes |
| `procurement_category` | `procurementCategory` | Yes |
| `project_subcategory` | `projectSubcategory` | Yes |
| `project_name` | `projectName` | Yes |
| `procurement_method` | `procurementMethod` | Yes |
| `winning_supplier` | `winningSupplier` | Yes |
| `winning_amount_yuan` | `winningAmountYuan` | Yes, nullable |
