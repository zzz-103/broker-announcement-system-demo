# 业务看板架构边界

## 运行边界

- `frontend/` 是正式静态前端；页面路由只装配 `src/features/` 中的业务模块。
- `backend/api/` 是唯一业务 HTTP 入口，负责认证、任务状态、SSE、数据读取和静态资源托管。
- 爬虫、LLM、匹配器和 `backend.broker_app_watch` 通过 FastAPI 启动短生命周期子进程，不作为常驻服务运行。
- `scripts/deploy-release.ps1` 与部署目录的 Compose 是 Windows 正式发布入口。

## 代码边界

- `backend/api/config.py`：环境变量、项目路径和有界运行参数。
- `backend/api/contracts.py`：后端请求/响应模型。
- `backend/api/main.py`：只负责应用、中间件、领域路由注册和静态前端挂载。
- `backend/api/routes/`：按账号与管理、数据、任务/SSE、AI 分析拆分的 HTTP 路由入口。
- `backend/api/dashboard_data.py` 与 `announcement_cache.py`：CSV、原子发布及轻量响应缓存。
- `backend/api/dashboard_package.py`：维护六文件 `dashboard-data` Export=Import 契约，负责字段归一化、统计、Manifest、校验、导出、导入和 live/imported 源选择。
- `backend/api/routes/dashboard_data.py`：正式前端读取当前选定数据源的标准化数据，以及管理员导出/导入入口。
- `backend/api/job_commands.py`：可信子进程命令；`job_manager.py` 负责生命周期、互斥、取消和事件。
- `backend/broker_app_watch/`：券商 App 更新的采集、解析、LLM、存储和 CLI；配置与数据分别归入 `backend/config/broker_app_watch/` 和 `backend/data/broker_app_watch/`。
- `frontend/src/lib/api/`：共享 HTTP/SSE 内核、契约和领域客户端。
- `shared/dashboard-data/contracts.ts`：标准数据包 Schema 类型，与后端导出层字段保持一致。
- `frontend/src/features/`：采购看板、App Watch、管理员控制台和 AI 自定义情报中心的稳定入口。
- `frontend/src/features/admin/use-job-runner.ts`：单活动任务的启动、SSE、轮询兜底、恢复、取消和资源清理。
- `backend/api/custom_intelligence_service.py` 与 `qianfan_search.py`：AI 情报助手的 Query Planning、百度普通搜索、简单来源筛选与 Report V2 生成。
- `frontend/src/features/custom-intelligence/`：AI 情报助手页面（生成报告、我的助手、历史报告与统一 Report V2 展示）。
- 数据清洗、去重、券商归一化、标签/分类、排序字段、基础统计和筛选项在导出层一次完成；访问端只基于标准化记录做当前筛选、简单排序、分页和图表交互派生，避免前端重复解释原始 CSV。
- dashboard-data GET 由后端内存缓存与 GZip 降低生成、传输成本；正式前端主动取最新包，避免跨页并发请求命中不完整的 304 缓存状态。接口仍保留 ETag 供其他兼容客户端使用。
- 数据服务默认选择 live 源（正式 CSV/JSON）；live 源缺失、损坏或无法通过校验时自动回退到已导入的 package。一次导入成功后，源状态切换为 imported，直到管理员显式恢复 live。来源偏好文件和经校验的六文件 ZIP 都持久化在 `DASHBOARD_DATA_EXPORT_DIR`，生产 Compose 的 `runtime/data:/app/backend/data` 会覆盖该目录，因此容器重建不会丢失选择状态。
- `GET /api/dashboard-data/*` 返回源选择器解析后的 Manifest 和标准化 JSON，不会盲目直接读取导出目录中的文件。前端只读取当前选定源，不读取 CSV、数据库或服务器路径；App 更新、AI 分析可在 Manifest 中标记为不可用。
- `frontend/src/components/ui/`：无业务含义的通用展示组件。

## 新看板或数据源接入

1. 在独立的后端 Python 模块中完成采集和原子数据输出，不增加常驻服务。
2. 在 `JobCommandFactory` 中注册固定命令，不接受浏览器传入脚本或任意参数。
3. 在集中配置中声明数据路径；API 路由只通过数据服务读取。
4. 在 `frontend/src/features/<name>/` 增加页面入口，并在领域 API 模块声明契约。
5. 如需持久目录，仅在发布脚本的运行目录清单及生产 Compose 中增加同一挂载。

现有 API 路径应优先保持兼容。需要减少传输字段时使用显式视图参数，例如
`GET /api/data/announcements?view=dashboard`，默认响应仍保留完整字段。

## 统一数据包流程

管理员可在管理控制台“前端数据包”导出或导入同一份六文件数据包，
也可在仓库根目录运行 `python scripts/export_dashboard_data.py --zip` 生成导出包。
六个文件固定为 `manifest.json`、`overview.json`、`filters.json`、
`tender_projects.json`、`app_updates.json` 和 `ai_analysis.json`。导入会复用同一套
Schema、版本、文件安全性、字节数、SHA-256、记录数和关键结构校验；校验通过后
以原子方式保存校验后的六文件 ZIP 与来源偏好到 `DASHBOARD_DATA_EXPORT_DIR`，并选择 imported 源。导出包不包含用户表、
密码、Token、原始路径、LLM 配置、自定义情报记录或邮件凭据。

没有 imported 数据时服务默认使用 live；当 live 暂时不可用时才自动回退到最近一次
有效 imported 数据。导入只更新 dashboard-data ZIP 和源状态，不触碰 `users.db`、
`audit.db`、自定义情报/邮件数据库、`.env`、LLM 配置或其他 secrets。正式前端始终通过
`GET /api/dashboard-data/*` 读取当前选定源，而不是把导出目录当作静态资源目录。
