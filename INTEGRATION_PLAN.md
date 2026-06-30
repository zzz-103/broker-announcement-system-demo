# INTEGRATION_PLAN.md

本文规划联调阶段，不实现业务代码。

## 审计结论

### 前端实际结构

- `frontend/package.json` 使用 Next.js 16、React 19、pnpm 9，脚本为 `pnpm dev/build/start/validate`。
- `frontend/src/app/page.tsx` 是客户端单页 Dashboard。
- 主要组件：`MetricCards`、`ExecutiveSummary`、`AiSummary`、三类图表、三类观察卡、`KeyProjectRadar`、`ProjectTable`、`ProjectDetailDrawer`、`DataDefinitionModal`。
- 状态管理：`frontend/src/store/filter-store.ts` 使用 Zustand。
- 数据处理：`frontend/src/lib/announcement-data.ts` 使用 PapaParse 解析 CSV，并在浏览器侧做字段清洗、分类、标签、指标、导出。
- 当前静态数据：`frontend/public/data/announcement_table.csv`，644 行。
- 当前 AI 缓存：`frontend/public/data/ai-analysis.json`。
- API Route：`frontend/src/app/api/ai-analysis/route.ts`。
- 自定义服务入口：`frontend/src/server.ts`，仅包装 Next request handler，使用 `COZE_PROJECT_ENV`、`HOSTNAME`、`PORT`。

### 后端实际结构

- `backend/pyproject.toml` 要求 Python 3.11+，依赖 `html2text`、`openai`、`playwright`、`pydantic`、`readability-lxml`。
- 配置：
  - `backend/config/spiders_config.json`
  - `backend/config/tasks.json`
  - `backend/config/llm_api_config.json`
- 核心脚本：
  - `backend/modules/crawler_engine.py`
  - `backend/modules/llm_markdown_table_builder.py`
  - `backend/modules/run_crawler_then_llm.py`
- 数据目录：
  - `backend/documents/markdown/`
  - `backend/documents/raw_announcements.sqlite3`
  - `backend/documents/structured_announcements/announcement_table.csv`
  - `backend/documents/structured_announcements/announcement_table.jsonl`
  - `backend/documents/structured_announcements/failed_files.jsonl`
  - `backend/documents/structured_announcements/run_summary.json`
  - `backend/documents/structured_announcements/raw_json/`

### README 与真实代码不一致

- 前端 README 是通用 Coze/Next 模板，描述了 `server/index.ts`，但真实入口是 `src/server.ts`。
- 前端 README 未描述当前券商分析面板、静态 CSV、`/api/ai-analysis` 和 Coze LLM SDK。
- 后端 README 描述的核心目录基本存在；实际还存在 `merge_summary.json`。
- 后端 README 的命令示例需要继续以源码参数为准。

### 当前真实数据流

1. 后端脚本输出 `backend/documents/structured_announcements/announcement_table.csv`。
2. 当前前端使用复制后的 `frontend/public/data/announcement_table.csv`。
3. 浏览器打开页面后，`loadAndProcessData()` 请求 `/data/announcement_table.csv`。
4. 浏览器用 PapaParse 解析 CSV，并在前端内存中完成筛选、分类、聚合和导出。

### 当前 AI 总结流程

1. `AiSummary` 首次加载 `GET /api/ai-analysis`。
2. `GET` 读取 `frontend/public/data/ai-analysis.json`。
3. 管理员刷新时，浏览器弹出自制 Basic 登录框。
4. `POST /api/ai-analysis` 校验 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`，默认值为 `admin/admin2026`。
5. Route 服务端读取 `frontend/public/data/announcement_table.csv`。
6. Route 聚合近 30 天数据。
7. Route 使用 `coze-coding-dev-sdk` 的 `LLMClient`，模型为 `glm-4-7-251222`，流式生成 SSE。
8. Route 写回 `frontend/public/data/ai-analysis.json`。

### 当前最大安全风险

- `/api/ai-analysis` 使用 Basic 认证且存在默认管理员账号密码。
- 管理员密码由浏览器输入并以 Basic header 发送，缺少正式 Session、角色、CSRF 和审计。
- Next.js Route 直接持有 LLM 调用能力，并写入 `public/data`。
- 后端 `config/llm_api_config.json` 存在 API Key，应从 Git 和代码配置中迁移到 Secret 管理。
- 后端脚本输出日志包含请求路径、模型、base_url、错误文本；必须避免打印 Secret。

## 后端脚本参数基线

### `crawler_engine.py`

入口：`raise SystemExit(asyncio.run(main()))`。

参数：

- `--brokers`，一个或多个 `spiders_config.json` 顶层 broker key。
- `--max-pages-per-broker`，默认 `3`。
- `--max-links-per-broker`，默认 `50`。
- `--headed`。
- `--request-retries`，默认 `1`。
- `--retry-backoff-seconds`，默认 `0.5`。
- `--force`。

退出码：正常返回 `0`；未捕获异常由 Python 产生非 0。

### `llm_markdown_table_builder.py`

入口：`raise SystemExit(main())`。

参数：

- `--input-dir`，默认 `backend/documents/markdown`。
- `--output-dir`，默认 `backend/documents/structured_announcements`。
- `--llm-config`，默认 `backend/config/llm_api_config.json`。
- `--broker-folders`。
- `--list-brokers`。
- `--max-files`。
- `--workers`，默认 `4`。
- `--max-concurrent-requests`。
- `--timeout-seconds`，默认 `120`，覆盖配置文件。
- `--overwrite`。
- `--min-interval-seconds`，默认 `0`。
- `--request-log-interval-seconds`，默认 `60`。
- `--incremental`，默认开启。
- `--full-refresh`。

退出码：列出 broker 返回 `0`；未找到 Markdown 返回 `1`；无新增且增量模式返回 `0`；参数错误由 argparse 返回非 0。

### `run_crawler_then_llm.py`

入口：`raise SystemExit(main())`。

参数：

- `--brokers`。
- `--max-pages-per-broker`，默认 `3`。
- `--max-links-per-broker`，默认 `50`。
- `--headed`。
- `--request-retries`，默认 `1`。
- `--retry-backoff-seconds`，默认 `0.5`。
- `--force-crawl`。
- `--skip-crawler`。
- `--llm-config`。
- `--llm-workers`，默认 `4`。
- `--llm-max-concurrent-requests`。
- `--llm-timeout-seconds`，默认 `120`。
- `--llm-min-interval-seconds`，默认 `0`。
- `--llm-request-log-interval-seconds`，默认 `60`。
- `--llm-overwrite`。
- `--llm-full-refresh`。

串联方式：先用 `subprocess.run` 执行爬虫；爬虫非 0 则直接返回该退出码。随后执行 LLM；LLM 退出码作为最终退出码。`--brokers` 会通过 `spiders_config.json` 的 `broker_id` 映射为 LLM 的 `--broker-folders`。

## CSV 基线

- 后端总表：644 行。
- 字段：`announcement_stage`、`broker_folder`、`broker_name`、`document_sha1`、`markdown_file`、`processed_at`、`procurement_category`、`procurement_method`、`project_name`、`project_subcategory`、`publish_date`、`raw_json_path`、`winning_amount_yuan`、`winning_supplier`。
- 编码：`utf-8-sig` 写入。
- 空值情况：
  - `announcement_stage`: 5
  - `broker_name`: 8
  - `procurement_category`: 5
  - `procurement_method`: 194
  - `project_name`: 5
  - `project_subcategory`: 5
  - `publish_date`: 89
  - `winning_amount_yuan`: 588
  - `winning_supplier`: 373
- `markdown_file` 重复组：44。
- 同一 Markdown 可能产生多条记录，因为 LLM 返回可为数组或 `records` 数组，`flatten_payload()` 会展开为多行。
- 当前 CSV 写入是直接覆盖目标文件，不是临时文件加原子 rename，存在被读取到半成品的风险。

## Broker Key

`spiders_config.json` 顶层允许的 broker key 包括：

`bhzq`, `ctsec`, `ctzq_chengtong`, `dbzq`, `dfzq`, `dgzq`, `gdzq`, `gfzq`, `gtht`, `gyzq`, `htzq`, `hxzq`, `njzq`, `sxzq`, `xnzq`, `xyzq`, `ykzq`, `cjzq`, `cmsc`, `zszq`, `yhzq`, `ztzq`, `citic`, `boci`, `zyzq`。

当前爬虫只加载 `enabled: true` 且匹配 `--brokers` 的配置。`run_crawler_then_llm.py` 将 broker key 映射到 `broker_id`，例如 `ctsec -> caitong_securities`。

## `/api/ai-analysis` 特别说明

- 当前 GET 不接收参数，读取 `public/data/ai-analysis.json`。
- 当前 POST 不读取 body，只读取 `Authorization: Basic ...`。
- POST 读取 `public/data/announcement_table.csv`。
- POST 调用 `coze-coding-dev-sdk` 的 `LLMClient`，模型 `glm-4-7-251222`。
- API Key 来源由 `coze-coding-dev-sdk` 的 `Config()` 和转发 header 决定，代码中没有显式读取 `NEXT_PUBLIC` Key。
- 当前没有发现 LLM API Key 暴露给浏览器，但 Basic 管理密码在浏览器输入并发送，默认密码风险高。
- 该 Route 可以保留为 BFF，路径和 SSE 返回格式尽量不变。
- 应迁移到 Python 后端：CSV 读取、聚合、Prompt 组装、LLM 调用、结果持久化。
- 应继续留在 Next.js：Session/角色校验、BFF 路由、SSE 转发、与现有 `AiSummary` 的兼容响应。

## 分阶段计划

### 1. 前端本地化启动

- 修改文件：`frontend/package.json`、`frontend/scripts/*.sh`、必要 README。
- 新增文件：无。
- 所需依赖：无。
- 验收标准：`pnpm dev`、`pnpm build`、`pnpm start` 在无 Coze CLI 时路径明确；静态 CSV 页面可打开。
- 风险：现有脚本依赖 bash、`ss`、`kill`，Windows 本地体验差。
- 回滚方式：恢复脚本和 README。

### 2. Python FastAPI 基础服务

- 修改文件：`backend/pyproject.toml`。
- 新增文件：`backend/app/main.py`、`backend/app/settings.py`、`backend/app/api/*`。
- 所需依赖：`fastapi`、`uvicorn`。
- 验收标准：健康检查、版本接口可用；不调用爬虫和 LLM。
- 风险：服务边界不清导致重复实现脚本逻辑。
- 回滚方式：删除 `backend/app` 并移除依赖。

### 3. 内部 JWT 和权限验证

- 修改文件：Next.js BFF 配置、Python app 安全中间件。
- 新增文件：`frontend/src/lib/internal-jwt.ts`、`backend/app/security.py`。
- 所需依赖：前端可用 `jose` 或 Next/Auth 生态；后端可用 `PyJWT` 或 `python-jose`。
- 验收标准：Python 拒绝无效 JWT；admin-only 接口拒绝 user。
- 风险：JWT Secret 泄露或过长有效期。
- 回滚方式：关闭内部接口，仅保留健康检查。

### 4. SQLite 任务管理

- 修改文件：`backend/pyproject.toml`。
- 新增文件：`backend/app/tasks/models.py`、`backend/app/tasks/repository.py`、迁移脚本或初始化逻辑。
- 所需依赖：优先标准库 `sqlite3`，如需 ORM 再评估。
- 验收标准：任务可创建、查询、状态流转。
- 风险：并发写锁。
- 回滚方式：删除任务表和任务 API。

### 5. subprocess 安全执行现有脚本

- 修改文件：无现有脚本逻辑，新增封装。
- 新增文件：`backend/app/tasks/runner.py`。
- 所需依赖：标准库。
- 验收标准：只允许白名单脚本和白名单参数；小范围任务可 dry-run 或执行受限命令。
- 风险：命令注入、误跑全量任务。
- 回滚方式：禁用任务执行入口。

### 6. CSV 校验和版本发布

- 修改文件：无核心脚本逻辑。
- 新增文件：`backend/app/data/validator.py`、`backend/app/data/versioning.py`。
- 所需依赖：可先用标准库 `csv`。
- 验收标准：校验字段、编码、行数、空值、重复键；发布版本原子切换。
- 风险：读取半成品 CSV。
- 回滚方式：恢复读取固定总表。

### 7. 数据查询和聚合 API

- 修改文件：前端数据读取适配层。
- 新增文件：`backend/app/api/announcements.py`、`backend/app/api/analytics.py`。
- 所需依赖：无新增或按性能评估 `pandas`。
- 验收标准：查询、筛选、分页、聚合与当前前端结果一致。
- 风险：前后端分类规则不一致。
- 回滚方式：前端继续读静态 CSV。

### 8. Auth.js、Prisma 和账号角色

- 修改文件：`frontend/package.json`、Next 配置。
- 新增文件：Auth.js 配置、Prisma schema、账号管理种子脚本。
- 所需依赖：`next-auth` 或 Auth.js 当前包、`prisma`、`@prisma/client`、数据库驱动。
- 验收标准：admin/user 登录、Session、角色校验可用。
- 风险：账号迁移和部署环境变量复杂。
- 回滚方式：移除 Auth 路由和 Prisma 配置。

### 9. Next.js BFF

- 修改文件：`frontend/src/app/api/*`。
- 新增文件：`frontend/src/lib/python-api.ts`。
- 所需依赖：内部 JWT 依赖。
- 验收标准：浏览器只调用 Next.js；Next.js 只调用 Python 内部服务。
- 风险：错误格式和流式响应不兼容。
- 回滚方式：保留旧静态 CSV 读取开关。

### 10. 管理员仪表盘

- 修改文件：新增管理页面和导航入口。
- 新增文件：`frontend/src/app/admin/page.tsx`、管理组件。
- 所需依赖：无或使用现有 UI 组件。
- 验收标准：admin 可创建小范围任务、查看状态、查看数据版本。
- 风险：误触发全量任务。
- 回滚方式：隐藏 admin 路由。

### 11. 普通用户分析页面接入

- 修改文件：`frontend/src/app/page.tsx`、`frontend/src/lib/announcement-data.ts`。
- 新增文件：`frontend/src/lib/api-data.ts`。
- 所需依赖：无。
- 验收标准：页面从 BFF 获取数据，功能与静态 CSV 版本一致。
- 风险：大数据量分页后影响现有前端全量聚合。
- 回滚方式：切回静态 CSV。

### 12. AI 总结迁移到服务端

- 修改文件：`frontend/src/app/api/ai-analysis/route.ts`。
- 新增文件：`backend/app/api/ai_analysis.py`、`backend/app/services/ai_summary.py`。
- 所需依赖：复用后端 `openai` 或现有兼容客户端。
- 验收标准：`AiSummary` 调用方式基本不变；LLM Key 不在 Next.js 和浏览器。
- 风险：SSE 转发中断和超时。
- 回滚方式：恢复旧 Route，但禁用默认密码。

### 13. 自动化测试

- 修改文件：前后端测试配置。
- 新增文件：前端组件/API 测试，后端单元/API 测试。
- 所需依赖：前端可选 `vitest`、`@testing-library/react`、`playwright`；后端可选 `pytest`、`httpx`。
- 验收标准：权限、查询、聚合、任务参数、CSV 校验有覆盖。
- 风险：测试数据与真实 CSV 偏离。
- 回滚方式：保留最小冒烟测试。

### 14. 本地启动和部署文档

- 修改文件：根 README 或新增部署文档。
- 新增文件：`.env.example`、部署说明。
- 所需依赖：无。
- 验收标准：新环境能按步骤启动前端、后端和受限任务。
- 风险：Secret 配置遗漏。
- 回滚方式：恢复上一版文档。

## 推荐开发顺序

先开发后端 FastAPI 和数据版本服务，再开发登录。原因：当前最大业务不确定性在真实 CSV、任务执行、数据版本、AI 总结迁移和脚本安全封装；登录应保护稳定的后端能力，而不是先把现有静态和 Basic 流程包装起来。

## 是否具备进入第二阶段

具备进入第二阶段的条件，但必须遵守两个前置条件：

- 第二阶段只做 Python FastAPI 基础服务、健康检查、只读数据版本/CSV 校验，不运行真实爬虫和真实 LLM。
- 在任何任务执行接口开发前，先完成白名单参数模型和禁止 full refresh 的默认策略。

