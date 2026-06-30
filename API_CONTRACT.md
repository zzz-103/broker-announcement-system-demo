# API_CONTRACT.md

本文只定义联调接口契约，不实现代码。

## 架构边界

- 浏览器只访问 Next.js BFF。
- Next.js 负责用户登录、Session、角色、CSRF 防护和浏览器可见 API。
- 角色分为 `admin` 和 `user`。
- Python FastAPI 是内部服务，只监听内网地址，不直接暴露给浏览器。
- Next.js 调用 Python 时使用短期内部 JWT。
- Python 负责读取已发布数据版本、查询公告、聚合数据、管理后台任务、调用现有爬虫和 LLM 脚本。

## 内部 JWT

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

规则：

- 有效期建议 5 分钟以内。
- Python 必须校验 `iss`、`aud`、`exp`、`role`。
- 管理类接口要求 `role=admin`。
- 查询类接口允许 `role=user` 或 `role=admin`。
- JWT 密钥只存在服务端环境变量，不得进入 `NEXT_PUBLIC_*`。

## 错误响应

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required",
    "requestId": "req_01H...",
    "details": {}
  }
}
```

常用状态码：

- `400`: 参数错误。
- `401`: 未登录或内部 JWT 无效。
- `403`: 角色不足。
- `404`: 资源不存在。
- `409`: 任务冲突或数据版本冲突。
- `422`: CSV 校验失败。
- `500`: 服务端错误。

## 数据版本

Python 内部接口：

```http
GET /internal/data/version
```

响应：

```json
{
  "version": "2026-06-29T09:36:32Z",
  "csvSha256": "hex",
  "rowCount": 644,
  "publishedAt": "2026-06-29T09:36:32Z",
  "sourcePath": "internal://structured_announcements/announcement_table.csv"
}
```

说明：

- 对外不得返回服务器真实绝对路径。
- 发布版本必须指向校验完成的稳定文件，避免读取半成品。

## 公告查询

Next.js BFF:

```http
GET /api/announcements?broker=...&stage=...&domain=...&q=...&from=2026-01-01&to=2026-06-30&page=1&pageSize=20&sort=publish_date_desc
```

Python 内部：

```http
GET /internal/announcements
```

响应：

```json
{
  "version": "2026-06-29T09:36:32Z",
  "page": 1,
  "pageSize": 20,
  "total": 644,
  "items": [
    {
      "id": "caitong_securities/063f439230bc970e85fc7213.md/0",
      "brokerName": "财通证券",
      "brokerFolder": "caitong_securities",
      "projectName": "项目名称",
      "publishDate": "2026-06-20",
      "announcementStage": "结果公示",
      "procurementCategory": "IT软硬件",
      "projectSubcategory": "数据平台",
      "procurementMethod": "公开招标",
      "winningSupplier": "供应商名称",
      "winningAmountYuan": 123456.78
    }
  ]
}
```

普通用户不得获得的内部字段：

- `document_sha1`
- `raw_json_path`
- `processed_at`
- 后端真实绝对文件路径
- LLM 请求配置
- shell 命令和任务执行环境

## 筛选选项

```http
GET /api/filter-options
```

响应：

```json
{
  "version": "2026-06-29T09:36:32Z",
  "brokers": [{"value": "caitong_securities", "label": "财通证券", "count": 33}],
  "stages": [{"value": "结果公示", "count": 271}],
  "procurementMethods": [{"value": "公开招标", "count": 120}],
  "domains": [{"value": "AI与智能化", "count": 45}]
}
```

## 数据聚合

```http
GET /api/analytics/summary?broker=...&stage=...&from=...&to=...
```

响应：

```json
{
  "version": "2026-06-29T09:36:32Z",
  "metrics": {
    "recordCount": 644,
    "uniqueProjectCount": 600,
    "recentProjectCount": 50,
    "resultProjectCount": 271,
    "supplierProjectCount": 120,
    "priceSampleCount": 56
  },
  "trend": [{"date": "2026-06-01", "count": 8}],
  "domainDistribution": [{"domain": "AI与智能化", "count": 45}],
  "stageDistribution": [{"stage": "结果公示", "count": 271}]
}
```

## 后台任务创建

仅 `admin`。

```http
POST /api/admin/tasks
Content-Type: application/json
```

请求：

```json
{
  "type": "crawl_then_llm",
  "brokers": ["ctsec"],
  "crawler": {
    "maxPagesPerBroker": 1,
    "maxLinksPerBroker": 5,
    "force": false
  },
  "llm": {
    "maxFiles": 5,
    "overwrite": false,
    "fullRefresh": false
  }
}
```

响应：

```json
{
  "taskId": "task_20260630_001",
  "status": "queued",
  "createdAt": "2026-06-30T10:00:00Z"
}
```

约束：

- `type`、`brokers` 和所有数值参数必须白名单校验。
- 默认禁止全量爬虫和 full refresh。
- 任务执行不得接受任意 shell 字符串。

## 后台任务状态

```http
GET /api/admin/tasks/{taskId}
```

响应：

```json
{
  "taskId": "task_20260630_001",
  "type": "crawl_then_llm",
  "status": "running",
  "phase": "llm",
  "createdAt": "2026-06-30T10:00:00Z",
  "startedAt": "2026-06-30T10:00:05Z",
  "finishedAt": null,
  "exitCode": null,
  "progress": {
    "processedFiles": 3,
    "failedFiles": 0
  },
  "message": "LLM incremental extraction running"
}
```

## AI 总结

读取：

```http
GET /api/ai-analysis
```

响应保持兼容：

```json
{
  "content": "Markdown summary",
  "updatedAt": "2026-06-30T10:00:00Z",
  "version": "2026-06-29T09:36:32Z"
}
```

生成：

```http
POST /api/ai-analysis
```

建议继续返回 SSE，以减少前端改动：

```text
data: {"content":"partial text"}

data: {"done":true,"updatedAt":"2026-06-30T10:00:00Z","version":"2026-06-29T09:36:32Z"}
```

分工：

- Next.js 继续保留 `/api/ai-analysis` 作为 BFF，负责 Session、角色和 SSE 转发。
- Python 负责读取稳定数据版本、聚合近 30 天数据、调用 LLM、保存总结结果。
- LLM API Key 只存在 Python 服务端环境变量或后端专用配置，不进入浏览器和 Next.js public 环境。

## CSV 字段映射

| 后端 CSV 字段 | 前端字段 | 对普通用户 |
| --- | --- | --- |
| `broker_folder` | `brokerFolder` | 可返回，作为稳定筛选值 |
| `broker_name` | `brokerName` | 可返回 |
| `markdown_file` | `sourceFileId` 或内部 id 组成部分 | 默认不直接展示 |
| `document_sha1` | 无 | 不返回 |
| `processed_at` | 无 | 不返回 |
| `raw_json_path` | 无 | 不返回 |
| `publish_date` | `publishDate` | 可返回 |
| `announcement_stage` | `announcementStage` | 可返回 |
| `procurement_category` | `procurementCategory` | 可返回 |
| `project_subcategory` | `projectSubcategory` | 可返回 |
| `project_name` | `projectName` | 可返回 |
| `procurement_method` | `procurementMethod` | 可返回 |
| `winning_supplier` | `winningSupplier` | 可返回 |
| `winning_amount_yuan` | `winningAmountYuan` | 可返回 |

