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

Phase B1 does not execute tasks. It only validates task requests, persists task metadata for internal service use, exposes admin read-only task inspection, and defines the state machine for B2.

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
