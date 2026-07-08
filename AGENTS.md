# AGENTS.md

## 1. 项目目标

这是一个公司内部使用的券商招采智能分析系统。

核心目标：管理员登录前端后，可运行爬虫、查看实时日志、运行 LLM 结构化处理、刷新看板数据，并生成与展示 AI 情报分析。

项目优先级：

1. 尽快可用。
2. 前后端职责清晰。
3. 改动范围小。
4. 不引入不必要的基础设施。
5. 保持现有爬虫、LLM 和看板业务逻辑稳定。

---

## 2. Codex 工作原则

开始工作前必须：

1. 阅读本文件。
2. 阅读与当前任务相关的真实代码。
3. 以实际代码、`argparse`、类型定义和接口实现为准。
4. 当本文、`intro.md` 和代码不一致时，以代码为准。
5. 只完成当前明确要求的阶段，不主动扩展范围。
6. 优先复用已有模块，避免复制近似实现。
7. 不进行无关重构。
8. 不为了“更先进”引入复杂架构。

本项目为内部单机优先的首版系统。除非任务明确要求，不使用 Redis、Celery、BullMQ、Kafka、RabbitMQ、数据库任务表、WebSocket、微服务、Kubernetes 或分布式锁。

---

## 3. 项目路径

本地常用路径：

```text
D:\broker-announcement-system-demo
```

代码中禁止写死该绝对路径。代码必须通过环境变量、`pathlib.Path`、`path.resolve` 或 `path.join` 处理路径。文档和本地启动示例可以使用该路径。

---

## 4. 当前架构

```text
 独立调度器进程 (APScheduler)
        ↓ HTTP (X-Scheduler-Token)
 浏览器   ↓
   ↓ HTTP / SSE
 Next.js 前端
   ↓ HTTP / SSE
 FastAPI 后端
   ↓ subprocess
 Python 爬虫 / LLM 结构化 / 自动化流水线
   ↓
 backend/data/*.csv / *.json
```

### Next.js 前端负责

- 登录界面
- 管理员操作界面
- 调用 FastAPI
- 读取 SSE
- 展示任务状态和日志
- 请求看板数据
- 展示图表、表格和 AI 分析结果

### FastAPI 后端负责

- 管理员认证
- Bearer Token 校验
- 启动 Python 子进程 (包括 Scraper, LLM) 及管理流水线 (Pipeline)
- 任务状态管理
- SSE 日志推送与取消任务控制
- 任务与操作互斥
- 结构化数据接口
- AI 情报分析接口与缓存读写
- 验证定时调度器的 `X-Scheduler-Token` 安全头并触发内部任务

### 独立调度器进程负责

- 定时触发：基于轻量级 APScheduler 进程，读取 CRON 表达式定时触发流水线
- 重试机制：支持网络瞬断等异常时的重试策略
- 认证鉴权：持有并发送 `X-Scheduler-Token` 请求后端

### Python 业务脚本负责

- 爬虫抓取
- Markdown 公告生成
- LLM 结构化提取
- CSV、JSONL、XLSX 生成

前端不得直接执行 Python、了解 Python 解释器路径、构造 Python 命令、读取后端文件系统、获取 LLM API Key 或直接调用外部 LLM。

---

## 5. 重要目录

```text
frontend/
├── src/app/
│   ├── page.tsx              # 看板主页面 (包含用户及管理员面板入口)
│   ├── globals.css           # 全局样式
│   └── layout.tsx            # 全局布局
├── src/components/
│   ├── admin-dashboard.tsx       # 管理员任务调度与配置控制台
│   ├── admin-task-progress.tsx   # 任务统一进度条组件
│   ├── admin-task-log-dialog.tsx # 详细日志弹窗组件
│   ├── user-approval-manager.tsx # 用户审批及权限管理组件
│   ├── login-page.tsx            # 登录页面组件
│   ├── charts.tsx                # 图表组件 (数据看板)
│   ├── project-table.tsx         # 招采项目表格展示
│   ├── ai-summary.tsx            # AI 智能摘要展示
│   └── executive-summary.tsx     # 核心指标与高管摘要
├── src/lib/
│   ├── api/
│   │   └── backend-client.ts # 集中式 FastAPI 客户端封装
│   ├── announcement-data.ts  # 数据模型定义与转换逻辑
│   └── utils.ts              # 通用辅助工具
├── src/store/
│   ├── auth-store.ts         # 登录会话与 Token 状态管理
│   └── filter-store.ts       # 筛选条件状态管理
└── .env.example              # 前端环境变量模板

backend/
├── api/
│   ├── main.py               # FastAPI 后端入口及核心 API 路由
│   ├── job_manager.py        # 子进程任务调度与状态管理锁
│   ├── scheduler.py          # 独立定时任务调度进程 (APScheduler)
│   ├── ai_analysis.py        # AI 智能情报分析处理逻辑
│   ├── user_store.py         # 用户账号存储及 SQLite 数据库接口
│   └── requirements.txt      # 后端 Python 依赖清单
├── config/
│   ├── llm_api_config.json   # 外部 LLM API 密钥与配置 (不提交)
│   └── llm_api_config.example.json # LLM 配置模板
├── data/
│   ├── announcement_table.csv  # 正式结构化招采数据 CSV (原子替换)
│   ├── ai-analysis.json        # AI 情报分析结果缓存 JSON (原子替换)
│   ├── users.db                # 用户账号 SQLite 数据库
│   └── staging/
│       └── announcement_table.csv # LLM 结构化提取候选临时数据
├── llm_table/
│   └── llm_markdown_table_builder.py # LLM 结构化表格提取与解析脚本
└── python-http-www-cfcpn-com-jcw/
    ├── cfcpn_scraper.py      # 爬虫抓取脚本
    └── output/notices/       # 爬虫抓取输出 notices 目录 (.md 格式)
```

旧运行时数据源 `frontend/public/data/announcement_table.csv` 不再作为正式数据源。正式结构化数据默认位于 `backend/data/announcement_table.csv`。

---

## 6. 核心数据流

### 爬虫

```text
cfcpn_scraper.py
→ backend/python-http-www-cfcpn-com-jcw/output/notices/*.md
```

### LLM 结构化

```text
output/notices/*.md
→ llm_markdown_table_builder.py
→ backend/data/staging/announcement_table.csv (候选数据源)
```

### 自动化流水线 (Pipeline)

```text
后端启动或调度器触发 pipeline 任务
→ 依次运行:
  1. cfcpn_scraper.py
  2. llm_markdown_table_builder.py
  3. AI 情报分析重构 (若 PIPELINE_ANALYSIS_ENABLED 为 true)
```

### 看板

```text
backend/data/announcement_table.csv
→ GET /api/data/announcements
→ Next.js 看板
```

### AI 情报分析

```text
announcement_table.csv
→ FastAPI AI 分析接口
→ backend/config/llm_api_config.json
→ 外部 LLM
→ backend/data/ai-analysis.json
→ Next.js AI 情报分析区域
```

---

## 7. FastAPI 接口

实际字段必须以代码为准。

当前核心接口：

```text
POST /api/login
GET  /api/health

POST /api/jobs/scraper
POST /api/jobs/llm
POST /api/jobs/pipeline
POST /api/internal/scheduled-pipeline
GET  /api/jobs/{job_id}
POST /api/jobs/{job_id}/cancel
GET  /api/jobs/{job_id}/events

GET  /api/data/announcements
POST /api/data/announcements/publish

GET  /api/ai-analysis
POST /api/ai-analysis

GET    /api/admin/users
POST   /api/admin/users
DELETE /api/admin/users/{user_id}
```

---

## 8. 认证规则

管理员配置来自环境变量：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me
```

规则：

1. 禁止在代码中写死管理员密码。
2. 禁止使用 `admin2026` 等默认密码回退。
3. `/api/login` 成功后返回随机 Session Token 和角色信息。
4. Token 及角色保存在 FastAPI 进程内存中。
5. 受保护接口使用 `Authorization: Bearer <token>`。
6. 前端 Token 只保存在 React 状态和 `sessionStorage`。
7. 禁止使用 `localStorage` 保存管理员 Token。
8. 401 时前端清除登录状态并要求重新登录。
9. FastAPI 重启后 Token 失效是首版可接受行为。
10. 暂不引入 JWT、OAuth、NextAuth 或第三方认证框架。
11. 审批用户可登录看板，但不得访问管理员任务和用户审批接口。

---

## 9. 任务执行规则

任务通过 FastAPI 使用 `subprocess.Popen` 启动，并启用无缓冲输出：

```text
python -u
PYTHONUNBUFFERED=1
PYTHONIOENCODING=utf-8
```

任务状态：

```text
pending
running
succeeded
failed
```

规则：

1. stdout 和 stderr 都收集。
2. stderr 不直接表示任务失败。
3. 最终以进程退出码判断成功或失败。
4. 子进程启动失败必须标记为 `failed`。
5. 无论成功、失败或异常，都必须释放锁。
6. 后端日志最多保留最近 500 行。
7. 前端最多显示最近 300 行。
8. 客户端断开 SSE 不得停止后端任务。
9. 不允许客户端传入脚本路径、命令或任意命令参数。
10. Python 路径、脚本路径、工作目录和数据目录通过环境变量配置。

---

## 10. 任务互斥规则

项目使用进程内锁：

- 互斥关系：
  - 爬虫运行时，不能启动 LLM 或自动化流水线（Pipeline）。
  - LLM 运行时，不能启动爬虫或自动化流水线（Pipeline）。
  - 自动化流水线（Pipeline）运行时，不能启动爬虫、LLM 或其它流水线，且锁住推送（Publish）与 AI 分析（AI Analysis）操作。
  - 推送（Publish）、AI分析（AI Analysis）运行时与流水线（Pipeline）互斥。
- 同类任务或冲突操作不能重复启动。
- 冲突返回 HTTP 409，错误信息应指出当前正在运行的任务类型。
- 任务取消：支持运行中任务的手动取消接口 (`POST /api/jobs/{job_id}/cancel`)，可中止运行中的子进程或整个流水线，中止后释放全局锁。
- 定时任务：已通过独立调度器进程实现周级/配置级定时触发流水线任务。

---

## 11. SSE 规则

接口：

```text
GET /api/jobs/{job_id}/events
```

响应类型：

```text
text/event-stream
```

事件示例：

```json
{"type":"start","job_id":"...","job_type":"scraper","message":"任务开始","timestamp":"..."}
{"type":"log","job_id":"...","stream":"stdout","message":"...","timestamp":"..."}
{"type":"log","job_id":"...","stream":"stderr","message":"...","timestamp":"..."}
{"type":"done","job_id":"...","status":"succeeded","exit_code":0,"timestamp":"..."}
```

规则：

1. 连接后，后端在最开始必须立即发送 2KB 规格的以冒号 `:` 开头的注释 Padding，强行冲刷（Flush）浏览器或代理的缓冲区，使前端能瞬间激活 `reader.read()` 开始接收日志。
2. 连接后先发送已有日志，再继续发送新日志。
3. 无日志时可以发送 `: ping`。
4. 任务结束后发送 `done` 并关闭连接。
5. 前端不能使用原生 `EventSource`，因为接口需要 Bearer Header。
6. 前端使用 `fetch`、`response.body.getReader()` 和 `TextDecoder`。
7. 必须正确处理 SSE 跨网络 chunk 拆分。
8. 必须维护字符串 buffer。
9. 不能对单个 chunk 直接 `split("\n")` 后立即 `JSON.parse`。
10. SSE 异常断开后，前端查询一次任务最终状态。
11. 前端启动任务后，10 秒未收到 SSE 业务事件时进入状态轮询回退。
12. 状态轮询每 2 秒查询 `GET /api/jobs/{job_id}`，看到 `succeeded` 或 `failed` 必须结束运行态。

---

## 12. 数据接口规则

接口：

```text
GET /api/data/announcements
```

默认文件：

```text
backend/data/announcement_table.csv
```

环境变量：

```env
ANNOUNCEMENT_CSV_PATH=backend/data/announcement_table.csv
```

建议响应：

```json
{
  "records": [],
  "meta": {
    "count": 0,
    "updated_at": "ISO-8601 或 null"
  }
}
```

规则：

1. 使用 Python 标准库 `csv`。
2. 使用 `utf-8-sig` 兼容 BOM。
3. 不返回服务器绝对路径。
4. 文件不存在返回 404。
5. 文件为空但表头有效时返回空数组。
6. 无法解析返回 500。
7. 错误响应不得包含 traceback。
8. 前端不得再请求 `/data/announcement_table.csv`。
9. LLM 成功后通过状态刷新重新请求数据。
10. 不优先使用整页 `window.location.reload()`。

---

## 13. AI 情报分析规则

唯一 LLM 配置来源：

```text
backend/config/llm_api_config.json
```

禁止把 API Key 放到前端、写死到代码、打印到日志、放入响应或写进 `.env.example`。

目标流程：

```text
读取 announcement_table.csv
→ 筛选最近 30 天数据
→ 复用现有分析提示词
→ 调用配置文件指定的 LLM
→ 校验模型响应
→ 原子写入 ai-analysis.json
→ 返回前端
```

默认缓存：

```text
backend/data/ai-analysis.json
```

建议环境变量：

```env
AI_ANALYSIS_CACHE_PATH=backend/data/ai-analysis.json
AI_ANALYSIS_WINDOW_DAYS=30
AI_ANALYSIS_TIMEOUT_SECONDS=120
```

规则：

1. GET 读取缓存。
2. POST 重新生成。
3. GET 需要 Bearer Token；POST 需要管理员 Bearer Token。
4. 同时只允许一个 AI 分析请求执行。
5. 重复 POST 返回 409。
6. 本阶段不需要 SSE。
7. LLM 超时返回 504。
8. 上游 LLM 错误返回 502。
9. 模型输出无法解析返回 502。
10. 允许清理 Markdown JSON 代码块后再解析。
11. 新结果必须原子写入缓存。
12. 失败时不得破坏上一版有效缓存。
13. 前端失败时保留上一版已显示结果。
14. 旧 Next.js `/api/ai-analysis` 迁移完成后应删除或明确废弃。
15. 前端最终必须调用 FastAPI，而不是旧 Next.js API Route。

---

## 14. 文件写入规则

正式数据和缓存应使用原子替换：

```text
写入同目录临时文件
→ flush/close
→ os.replace
```

适用于：

- `announcement_table.csv`
- `ai-analysis.json`

规则：

1. 临时文件和目标文件必须在同一目录。
2. 写入失败不能破坏上一版有效文件。
3. 异常时清理临时文件。
4. 不提交真实运行数据，除非任务明确要求。
5. `backend/data/.gitkeep` 可以保留。

---

## 15. 前端规则

技术栈：Next.js、TypeScript、React、原生 `fetch`、现有 UI 组件。

规则：

1. 不引入 Axios，除非任务明确要求。
2. 不复制 API 请求逻辑。
3. API 调用优先集中在 `frontend/src/lib/api/backend-client.ts`。
4. 数据转换优先集中在 `frontend/src/lib/announcement-data.ts`。
5. 不随意使用 `any`。
6. 为接口响应和 SSE 事件定义简单类型。
7. 不大改现有看板样式。
8. 不重构无关页面。
9. 运行期间禁用对应按钮。
10. 401 自动退出登录。
11. 409 显示明确冲突提示。
12. 网络错误显示可理解信息。
13. 数据加载失败不能导致整个页面白屏。
14. 组件卸载时用 `AbortController` 停止前端流读取。
15. 前端停止读取不等于取消后端任务。
16. LLM 成功后刷新看板；爬虫成功后不刷新结构化看板。
17. AI 分析成功后只更新分析区域，不整页刷新。

---

## 16. 后端规则

技术栈：FastAPI、Python 标准库优先、`subprocess.Popen`、进程内任务状态、进程内 Session Token、进程内锁。

规则：

1. 优先复用 `job_manager.py`。
2. 不为新任务复制一整套任务管理实现。
3. 只在确实必要时增加依赖。
4. 新依赖必须写入 `backend/api/requirements.txt`。
5. 使用 `pathlib.Path`。
6. CORS 只允许配置的前端 Origin。
7. 不使用 `*` 作为生产默认 CORS。
8. HTTP 错误使用简洁 `detail`。
9. 不向前端返回 traceback。
10. 不向前端返回服务器绝对路径。
11. 配置错误不能导致整个服务崩溃。
12. 外部 LLM 调用必须设置超时。
13. API Key、Token 和密码不得进入日志。

---

## 17. 环境变量

前端：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

后端常用变量：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me
FRONTEND_ORIGIN=http://localhost:3000,http://localhost:5000

SCRAPER_PYTHON_EXECUTABLE=
SCRAPER_SCRIPT_PATH=
SCRAPER_WORKING_DIR=

LLM_PYTHON_EXECUTABLE=
LLM_SCRIPT_PATH=
LLM_WORKING_DIR=
LLM_INPUT_DIR=
LLM_OUTPUT_DIR=backend/data/staging
LLM_CONFIG_PATH=backend/config/llm_api_config.json
LLM_WORKERS=4

ANNOUNCEMENT_STAGING_CSV_PATH=backend/data/staging/announcement_table.csv
ANNOUNCEMENT_CSV_PATH=backend/data/announcement_table.csv
USER_DB_PATH=backend/data/users.db

AI_ANALYSIS_CACHE_PATH=backend/data/ai-analysis.json
AI_ANALYSIS_WINDOW_DAYS=30
AI_ANALYSIS_TIMEOUT_SECONDS=120

# 流水线阶段 AI 分析配置
PIPELINE_ANALYSIS_ENABLED=true
PIPELINE_ANALYSIS_DAYS=30

# 独立调度器进程配置
SCHEDULER_ENABLED=true
SCHEDULER_TIMEZONE=Asia/Shanghai
SCHEDULER_CRON=0 12 * * sun
SCHEDULER_API_URL=http://localhost:8000
SCHEDULER_TOKEN=change-me
```

规则：

1. `.env.example` 只放示例。
2. 禁止提交真实密码和 API Key。
3. 前端可公开变量只能使用 `NEXT_PUBLIC_`。
4. API Key 不能使用 `NEXT_PUBLIC_`。
5. 修改环境变量后必须重启对应服务。
6. `FRONTEND_ORIGIN` 可用英文逗号配置多个本地 Origin，例如 `http://localhost:3000,http://127.0.0.1:3000`。

---

## 18. 本地启动命令

### FastAPI

在项目根目录：

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\api\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 0.0.0.0 --port 8000 --reload
```

检查：

```text
http://localhost:8000/api/health
http://localhost:8000/docs
```

### 独立调度器 (Scheduler)

在项目根目录：

```powershell
.\.venv\Scripts\python.exe -m backend.api.scheduler
```

### Next.js

在 `frontend` 目录：

```powershell
pnpm install
pnpm build
pnpm dev
```

默认地址通常是 `http://localhost:3000`。如果端口变化，必须同步更新 `FRONTEND_ORIGIN` 和 `NEXT_PUBLIC_API_BASE_URL`。

### 任务联调

任务接口：

```text
POST /api/jobs/scraper
POST /api/jobs/llm
POST /api/jobs/pipeline
POST /api/internal/scheduled-pipeline
GET  /api/jobs/{job_id}
GET  /api/jobs/{job_id}/events
POST /api/jobs/{job_id}/cancel
```

`GET /api/jobs/{job_id}` 可返回 `pid`、`log_count`、`last_event_at`、`process_alive` 和最近事件 `events` 等非敏感诊断字段，用于 SSE 异常时前端轮询回补。SSE 首包必须有 2KB 注释 padding，无业务日志时约 10 秒发送 `: ping`。如任务异常卡住，可用管理员 Token 调用 cancel 接口，或在本机确认 PID 后手动终止对应 Python 子进程；不得把命令行密钥或 Token 写入日志。

---

## 19. 验证要求

每次修改至少完成与任务相关的验证。

### 后端基础验证

```powershell
.\.venv\Scripts\python.exe -m py_compile backend\api\main.py backend\api\job_manager.py
```

按需验证：

- 健康检查
- 正确/错误登录
- 无 Token 401
- 重复任务 409
- 成功/失败状态
- 失败后可重启
- SSE 逐步输出
- 数据文件不存在 404
- 临时 CSV 正常解析
- 配置错误时服务不崩溃

### 前端基础验证

```powershell
pnpm build
```

按需验证：

- 登录请求调用 FastAPI
- 不再调用旧 Next API
- Token 使用 `sessionStorage`
- 页面刷新恢复会话
- SSE 实时显示
- 按钮运行期间禁用
- 401 自动退出
- 409 明确提示
- 数据接口 404 有正常空状态
- 无白屏
- 浏览器控制台无关键错误
- LLM 成功后看板刷新
- AI 分析成功后分析区域更新

### 真实外部调用

除非任务明确允许：

- 不主动消耗真实 LLM 配额。
- 可以使用模拟响应验证流程。
- 未调用真实服务时必须写“未验证”。
- 不得声称真实链路已经验证。

---

## 20. 修改范围纪律

Codex 必须遵守：

1. 一次只解决当前任务。
2. 不主动增加“顺便优化”。
3. 不大规模格式化无关文件。
4. 不改无关变量名。
5. 不修改爬虫核心逻辑，除非任务明确要求。
6. 不修改 LLM 提取提示词，除非任务明确要求。
7. 不修改 CSV 字段定义，除非任务明确要求。
8. 不重做看板 UI。
9. 不创建第二套认证。
10. 不创建第二套任务管理。
11. 不创建第二套 LLM 配置。
12. 不保留两套仍在使用的同功能 API。
13. 迁移完成后删除或明确废弃旧入口。
14. 发现实现与任务描述冲突时，以代码为准并在结果中说明。

---

## 21. 安全要求

禁止提交或输出：

- 管理员真实密码
- LLM API Key
- Bearer Token
- Cookie
- 内部凭据
- 完整生产配置
- 服务器 traceback
- 服务器绝对路径
- 用户可控系统命令

禁止：

- 使用 `shell=True` 执行用户输入
- 接收客户端脚本路径
- 接收客户端任意 CLI 参数
- 把 LLM 配置暴露给浏览器
- 在前端调用外部 LLM
- 使用默认弱密码作为回退

---

## 22. 当前项目状态

截至本次更新，已完成：

- FastAPI 服务
- 管理员登录
- Bearer Session Token
- 爬虫任务及 SSE 日志
- LLM 结构化任务及 SSE 日志
- 爬虫与 LLM 互斥
- `GET /api/data/announcements`
- 前端真实登录
- 前端运行爬虫和 LLM
- 前端实时日志
- 前端通过 FastAPI 加载看板
- CSV 原子写入
- 管理员用户资格审批录入
- `GET/POST/DELETE /api/admin/users`
- 审批用户登录看板
- FastAPI AI 情报分析接口 (`GET/POST /api/ai-analysis`)
- `ai-analysis.json` 后端缓存（原子写入）
- 前端 AI 情报分析已迁移至 FastAPI
- LLM 输出候选 CSV（`backend/data/staging/announcement_table.csv`）
- 推送接口 (`POST /api/data/announcements/publish`) 实现原子替换
- 全局互斥（爬虫、LLM、推送、AI 分析、流水线操作同一时间只允许一个执行）
- 统一任务进度条（`AdminTaskProgress`）
- 详细日志弹窗（`AdminTaskLogDialog`，点击图标查看，不直接展开在页面上）
- SSE 首事件超时后的状态轮询回退，避免前端永久停留在运行中
- 任务状态接口返回 `pid/log_count/last_event_at/process_alive/events` 诊断字段
- 三张任务卡片统一排版，按钮固定在底部，高度对齐
- LLM 成功后不刷新看板，仅推送成功后刷新
- 推送失败时正式 CSV 保持不变（原子替换保证）
- `backend/data/staging/.gitkeep` 已提交，运行时 CSV 通过 `.gitignore` 排除
- 自动化流水线（Pipeline）一键运行功能（串联 scraper -> llm -> analysis）与 API 触发
- 独立定时任务调度进程（Scheduler），基于 APScheduler 实现 CRON 调度，持有 `X-Scheduler-Token` 安全头进行内部验证触发
- 任务取消机制：通过 `POST /api/jobs/{job_id}/cancel` 支持中止运行中的子进程或流水线

待完成或待最终验收：

- 真实端到端流程验证（爬虫→LLM→推送→看板刷新全链路）
- 真实 LLM AI 情报分析调用验证（需 llm_api_config.json 配置）
- 完整生产部署和启动说明

状态变化后应更新本节。

---

## 23. Codex 返回格式

为了节约 Token，完成任务后不要粘贴完整代码或 diff。

默认只返回：

```text
状态：完成 / 部分完成

修改文件：
- 文件路径
- 文件路径

验证：
- 通过：...
- 未验证：...

关键说明：
- ...

阻塞：
- 无
```

规则：

1. 总回复尽量控制在 15 行以内。
2. 不重复任务描述。
3. 不粘贴完整代码。
4. 不粘贴完整 diff。
5. 不输出长篇解释。
6. 未验证内容必须明确列出。
7. 只有真实执行过的验证才能写“通过”。

---

## 24. 完成定义

一项任务只有同时满足以下条件，才可以标记“完成”：

1. 代码已经修改。
2. 相关接口或页面已经接通。
3. 至少完成可执行的基础验证。
4. 未验证项已明确列出。
5. 没有泄露密码、Token 或 API Key。
6. 没有引入范围外的复杂依赖。
7. 没有破坏已稳定链路。
8. 环境变量示例和必要说明已经同步更新。

如果缺少构建、浏览器端到端或真实外部服务验证，应在“未验证”中明确说明，不能把“代码已写”描述为“完整链路已验证”。
