# Codex / AI Agent 项目入口

## 项目与原则

这是公司内部使用的券商招采智能分析系统。正式链路由 Next.js 静态前端、单 worker FastAPI、Python 采集/LLM/匹配任务，以及独立 APScheduler 进程组成。

修改优先级：尽快可用、职责清晰、改动小、保持业务口径稳定。以真实代码、类型、`argparse` 和 OpenAPI 为准；文档冲突时先修正文档。不要进行无关重构，不要引入 Redis、Celery、消息队列、微服务、WebSocket 或第二套认证/任务/LLM 配置。

## 开始工作前

1. 阅读本文件和任务涉及的真实代码、调用方、测试与配置。
2. 删除前检查 import、脚本、Compose、发布、CI、文档和低频运维引用。
3. 保留用户已有改动与运行数据，不格式化无关文件。
4. 真实爬虫、搜索、LLM 和邮件调用需要任务明确授权与凭据；未执行时写“未验证”。

## 目录与边界

```text
frontend/                         唯一正式前端；静态导出，不承载后端逻辑
backend/api/                      FastAPI、认证、任务/SSE、数据包、管理与情报 API
backend/python-http-*/            金采网公告采集
backend/broker_sources/           券商官网来源采集与来源选择
backend/llm_table/                公告 LLM 结构化
backend/matching/                 采购/结果公告匹配、复核和合并
backend/broker_app_watch/         App 更新采集、解析、LLM、存储与 CLI
backend/config/                   非敏感示例配置；真实配置不提交
backend/data/                     运行数据；Git 只保留必要目录占位
shared/dashboard-data/            前后端共享数据包 TypeScript 契约
scripts/                          长期发布与无界面导出入口
deploy/                           Windows 生产 Compose 与 Nginx 模板
docs/ARCHITECTURE.md              当前真实架构、模块和数据流
docs/OPERATIONS.md                从零安装、运行、导入、发布和排障
```

前端只能通过 `frontend/src/lib/api/` 访问 FastAPI，不得执行 Python、读取后端文件、持有 LLM Key 或调用外部 LLM。后端通过固定可信命令启动子进程，不接受浏览器传入脚本路径或任意 CLI 参数。

## 关键运行约束

- FastAPI 必须单 worker：Session、任务状态、互斥锁和日志在进程内。
- 子进程使用无缓冲 UTF-8 输出；退出码决定成败，stdout/stderr 都收集，结束必须释放锁。
- SSE 使用带 Bearer Header 的 `fetch`；首包 2KB 注释 padding，前端维护跨 chunk buffer，10 秒无业务事件后轮询兜底。
- Token 仅在前端内存和 `sessionStorage`；禁止 `localStorage`。401 清会话，409 显示冲突任务。
- 正式数据和缓存采用同目录临时文件 + `os.replace` 原子替换；失败不得破坏上一版。
- 完整 Pipeline 顺序执行采集、双公告结构化、匹配复核、合并、安全发布和可选 AI 分析。除非任务明确要求，不修改匹配规则、CSV 字段或 Prompt。
- 看板读取 `/api/dashboard-data/*` 当前源。数据包包含 Manifest、5 个标准数据集，并可按 Manifest 携带 `matching_baseline.json`；导入不覆盖用户、审计、情报/邮件数据库或任何凭据。
- 自定义情报默认复用 `USER_DB_PATH`；百度、共享 LLM、SMTP 凭据只在服务端环境或受限运行配置中保存。
- 前端保持 Next.js 静态导出；不得新增需要常驻 Node.js 的 Route Handler、Server Action 或 cookies。

## 配置与数据

配置入口是根 `.env`、`backend/config/llm_api_config.json` 和管理员“AI 技术配置”。仓库只提交 `.env.example`、`llm_api_config.example.json`、资格名单示例及 App Watch 非敏感配置。

重要运行路径：

- 正式招采：`backend/data/announcement_table.csv`
- App 更新：`backend/data/broker_app_watch/exports/app_releases.csv`
- AI 摘要：`backend/data/ai-analysis.json`
- 数据包与源状态：`DASHBOARD_DATA_EXPORT_DIR`
- 用户/情报：`USER_DB_PATH`
- 审计：`AUDIT_DB_PATH`
- LLM 中间数据：`backend/data/staging/`

禁止提交或输出 `.env`、真实 API Key、密码、Token、Cookie、资格名单、SQLite、运行 CSV/JSON、日志、缓存、构建产物或开发者绝对路径。

## API 与扩展入口

接口以 `backend/api/routes/` 和运行时 `/docs` 为准。领域路由包括账号/审计、数据集、任务/SSE、AI 分析、dashboard-data 导入导出与源选择、自定义情报及其管理员配置。

新增数据源时：在独立后端模块完成采集和原子输出，在 `JobCommandFactory` 注册固定命令，在集中配置声明路径，再通过领域 API 和 `frontend/src/lib/api/` 接入。新增页面放入 `frontend/src/features/<name>/`，保持静态导出兼容。

## 测试与验收

测试应少而清晰，保护认证、任务互斥/取消、发布保护、数据包 Export=Import、公告匹配、采集解析、App Watch 和自定义情报持久化。测试产物写临时目录，不调用真实外部服务。

```bash
.venv/bin/python -m pytest -q
cd frontend
pnpm run ts-check
pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= pnpm build
```

按风险补充 health、登录、401/403、数据包导入导出和页面 smoke。只有命令真实退出 0 才能称为通过。

## 子代理协作

- 几分钟内可完成的任务留在主线程；体量大、边界独立的任务优先委派 `luna_worker`。
- worker 任务写清目标、读取范围、唯一允许修改的文件、禁止范围、输出与验收标准；只读权限可宽于写权限。
- 并发写入使用独立 worktree；无法隔离时串行。worker 不得扩大范围或回退他人改动。
- worker 返回：状态、结论、修改文件、关键变更、验证命令、验证结果。主线程按委派标准复核。

## 禁止事项

不要建立第二套前端、认证、任务管理或 LLM 配置；不要把运行数据当测试 fixture；不要硬编码本机路径；不要使用 `shell=True` 执行用户输入；不要泄露 traceback 或服务器绝对路径；不要为了“规范”移动稳定模块或建立复杂测试体系。

交接、部署与故障处理只维护在 [README.md](README.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/OPERATIONS.md](docs/OPERATIONS.md)。
