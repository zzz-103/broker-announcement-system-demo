# 交接速查

## 先看哪里

| 目标 | 入口 | 运行数据 |
| --- | --- | --- |
| 招采看板 | `frontend/src/features/procurement/`、`backend/api/dashboard_package.py` | `backend/data/announcement_table.csv`、`backend/data/dashboard-data/` |
| App 更新 | `frontend/src/features/app-watch/`、`backend/broker_app_watch/` | `backend/data/broker_app_watch/` |
| 自定义情报 | `frontend/src/features/custom-intelligence/`、`backend/api/custom_intelligence_service.py` | `USER_DB_PATH`（默认 `backend/data/users.db`） |
| 管理任务 | `frontend/src/features/admin/`、`backend/api/job_manager.py` | 进程内任务状态；正式输出见上述数据目录 |
| 调度器 | `backend/api/scheduler.py` | 无独立业务数据库，通过内部 HTTP 触发 API |

代码与配置可提交；`backend/data/`、爬虫 output、SQLite、真实资格名单和 `llm_api_config.json` 都按运行数据/私密配置管理。仓库内正式 CSV 是演示种子，不应当作生产事实或测试 fixture；新增可重复测试数据应放在具体测试的临时目录中。
后端测试脚本统一位于各模块的 `tests/` 目录；可复用静态样本放在对应的 `tests/fixtures/`，测试运行产生的 CSV、SQLite 和缓存必须写入临时目录。

## 启动、配置与排障

- 最短本地启动见根 `README.md`；生产拓扑模板见 `deploy/`，FastAPI 必须保持单 worker。
- 配置入口是根 `.env`、旧版 `backend/config/llm_api_config.json` 与管理员“AI 技术配置”。百度、共享 DeepSeek 和网易 SMTP 授权码均只在服务端保存；管理员二次验证密码后可查看和替换，普通用户不可见。管理员保存的 DeepSeek 覆盖文件默认是被忽略的 `backend/data/llm_api_config.override.json`，优先于旧配置，并供 AI 情报助手、招采 AI 分析、App Watch 与 LLM 结构化任务共同使用。
- 新账号使用一次性随机初始密码；重复申请不会返回或重置既有密码。初始密码只在创建响应中出现一次，应通过内部安全渠道交付。
- 用户申请依赖 `USER_QUALIFICATION_CSV_PATH`；表头样例见 `backend/config/user_qualification.example.csv`。
- 管理任务日志通过管理页 SSE 查看，内存最多保留最近 500 行；容器日志使用 `docker compose logs -f backend-api` / `backend-scheduler`。
- 看板异常先查 `/api/health`、`/api/dashboard-data/manifest`、管理页任务最终状态和 `backend/data/dashboard-data/manifest.json`；自定义情报再查管理页连接测试与对应执行记录。
- `.env` 修改后重启 API/调度器；前端公开变量变化后重新构建静态产物。

## 数据更新与扩展

- 正式完整更新只启动 Pipeline：采集、来源选择、双公告结构化、匹配、合并、安全发布、可选 AI 分析顺序执行。候选为空或留存比例不足会失败并保留上一版。
- 单独 LLM 任务不会自动发布，完成后由管理员“更新看板”；正式 CSV 使用同目录临时文件、备份和 `os.replace`。
- 新增券商官网来源：在 `backend/broker_sources/` 增加 collector 与配置，并保持 `official > cfcpn > external` 选择契约及空源保护。
- 新增 App 来源：修改 `backend/config/broker_app_watch/brokers.yaml`，先运行 `check-config` 与 `dry-run`。
- 新增搜索能力：扩展 `qianfan_search.py` 的固定服务端适配，不把 Endpoint、Key 或任意请求参数开放给浏览器。

## 兼容与历史边界

- 正式前端只消费 `/api/dashboard-data/*`；`/api/data/announcements`、`/api/app-releases` 保留为兼容/管理入口，新页面不得再接入。
- `/api/ai-analysis` 仍是固定近 30 天全局 AI 摘要，和招采页当前筛选无关；页面已明确该口径。
- Session、任务互斥和 SSE 历史是单进程内存状态；重启失效、多 worker 不受支持，这是当前单机架构的明确边界。
- `dashboard_package.py` 与 LLM 表格构建器虽较大，但承载稳定业务规则；交接阶段不做大拆分，新增逻辑优先提取可测试纯函数。

## 最小回归

1. 登录、申请账号、管理员创建用户；无 Token 为 401，非管理员为 403。
2. Pipeline 成功自动发布；空候选/低留存失败且正式 CSV 不变；任务取消后能再次启动。
3. 招采/App 数据包加载、筛选、详情、导出；空数据与 401 不白屏。
4. 自定义情报搜索中/分析中/成功/空结果/分析失败五种状态，历史切换、重跑、重分析、PDF 终态限制。
5. SSE 首包 padding、分块解析、断线轮询兜底；生产 Compose 四服务及首页、health、version smoke。
