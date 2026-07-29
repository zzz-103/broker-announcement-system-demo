# 业务看板架构边界

## 运行边界

- `frontend/` 是正式静态前端；页面路由只装配 `src/features/` 中的业务模块。
- `frontend-coze/` 是独立交付物，不参与正式前端构建、FastAPI 托管或本次模块复用。
- `backend/api/` 是唯一业务 HTTP 入口，负责认证、任务状态、SSE、数据读取和静态资源托管。
- 爬虫、LLM、匹配器和 `broker-app-watch` 通过 FastAPI 启动短生命周期子进程，不作为常驻服务运行。
- `scripts/deploy-release.ps1` 与部署目录的 Compose 是 Windows 正式发布入口。

## 代码边界

- `backend/api/config.py`：环境变量、项目路径和有界运行参数。
- `backend/api/contracts.py`：后端请求/响应模型。
- `backend/api/main.py`：只负责应用、中间件、领域路由注册和静态前端挂载。
- `backend/api/routes/`：按账号与管理、数据、任务/SSE、AI 分析拆分的 HTTP 路由入口。
- `backend/api/dashboard_data.py` 与 `announcement_cache.py`：CSV、原子发布及轻量响应缓存。
- `backend/api/job_commands.py`：可信子进程命令；`job_manager.py` 负责生命周期、互斥、取消和事件。
- `frontend/src/lib/api/`：共享 HTTP/SSE 内核、契约和领域客户端。
- `frontend/src/features/`：采购看板、App Watch 和管理员控制台的稳定入口。
- `frontend/src/features/admin/use-job-runner.ts`：单活动任务的启动、SSE、轮询兜底、恢复、取消和资源清理。
- 看板筛选、搜索、统计和图表派生在访问端完成；服务端只提供投影后的压缩数据。
- 数据 GET 使用浏览器私有缓存协商，重复访问通过 ETag/304 避免再次传输完整数据。
- `frontend/src/components/ui/`：无业务含义的通用展示组件。

## 新看板或数据源接入

1. 在独立 Python 包中完成采集和原子数据输出，不增加常驻服务。
2. 在 `JobCommandFactory` 中注册固定命令，不接受浏览器传入脚本或任意参数。
3. 在集中配置中声明数据路径；API 路由只通过数据服务读取。
4. 在 `frontend/src/features/<name>/` 增加页面入口，并在领域 API 模块声明契约。
5. 如需持久目录，仅在发布脚本的运行目录清单及生产 Compose 中增加同一挂载。

现有 API 路径应优先保持兼容。需要减少传输字段时使用显式视图参数，例如
`GET /api/data/announcements?view=dashboard`，默认响应仍保留完整字段。
