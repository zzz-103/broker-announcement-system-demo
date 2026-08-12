# 交接速查

## 先看哪里

| 目标 | 入口 | 运行数据 |
| --- | --- | --- |
| 招采看板 | `frontend/src/features/procurement/`、`backend/api/dashboard_package.py` | live：`backend/data/announcement_table.csv`；imported：`DASHBOARD_DATA_EXPORT_DIR` 的六文件 ZIP 与来源状态 |
| App 更新 | `frontend/src/features/app-watch/`、`backend/broker_app_watch/` | live：`backend/data/broker_app_watch/exports/app_releases.csv`；imported：导入 ZIP 中的 `app_updates.json` |
| 自定义情报 | `frontend/src/features/custom-intelligence/`、`backend/api/custom_intelligence_service.py` | `USER_DB_PATH`（默认 `backend/data/users.db`） |
| 管理任务 | `frontend/src/features/admin/`、`backend/api/job_manager.py` | 进程内任务状态；正式输出见上述数据目录 |
| 调度器 | `backend/api/scheduler.py` | 无独立业务数据库，通过内部 HTTP 触发 API |

代码与配置可提交；`backend/data/`、爬虫 output、SQLite、真实资格名单和 `llm_api_config.json` 都按运行数据/私密配置管理。仓库内正式 CSV 是演示种子，不应当作生产事实或测试 fixture；新增可重复测试数据应放在具体测试的临时目录中。dashboard-data 的六文件 Export=Import 包只包含看板公开数据和校验元数据，绝不能携带 users/audit、自定义情报、邮件配置或任何 secret。
后端测试脚本统一位于各模块的 `tests/` 目录；可复用静态样本放在对应的 `tests/fixtures/`，测试运行产生的 CSV、SQLite 和缓存必须写入临时目录。

## 启动、配置与排障

- 最短本地启动见根 `README.md`；生产拓扑模板见 `deploy/`，FastAPI 必须保持单 worker。
- 配置入口是根 `.env`、旧版 `backend/config/llm_api_config.json` 与管理员“AI 技术配置”。百度、共享 DeepSeek 和网易 SMTP 授权码均只在服务端保存；管理员二次验证密码后可查看和替换，普通用户不可见。管理员保存的 DeepSeek 覆盖文件默认是被忽略的 `backend/data/llm_api_config.override.json`，优先于旧配置，并供 AI 情报助手、招采 AI 分析、App Watch 与 LLM 结构化任务共同使用。
- 新账号使用一次性随机初始密码；重复申请不会返回或重置既有密码。初始密码只在创建响应中出现一次，应通过内部安全渠道交付。
- 用户申请依赖 `USER_QUALIFICATION_CSV_PATH`；表头样例见 `backend/config/user_qualification.example.csv`。
- 管理任务日志通过管理页 SSE 查看，内存最多保留最近 500 行；容器日志使用 `docker compose logs -f backend-api` / `backend-scheduler`。
- 看板异常先查 `/api/health`、`/api/dashboard-data/manifest`、Manifest 的 source（live/imported）、管理页任务最终状态和 `DASHBOARD_DATA_EXPORT_DIR` 下的六文件；确认 live 无效时是否按规则回退 imported。不要把导出目录当作 GET 的静态数据源。自定义情报再查管理页连接测试与对应执行记录。
- `.env` 修改后重启 API/调度器；前端公开变量变化后重新构建静态产物。

## 数据更新与扩展

- 正式完整更新只启动 Pipeline：采集、来源选择、双公告结构化、匹配、合并、安全发布、可选 AI 分析顺序执行。候选为空或留存比例不足会失败并保留上一版。
- 单独 LLM 任务不会自动发布，完成后由管理员“更新看板”；正式 CSV 使用同目录临时文件、备份和 `os.replace`。
- 看板数据包遵循六文件 Export=Import 契约。默认源为 live；成功导入后切换为 imported，校验后的导入 ZIP 和来源状态持久化在 `DASHBOARD_DATA_EXPORT_DIR`，生产的 `runtime/data:/app/backend/data` 挂载负责跨重启保留。live 暂时缺失/损坏时自动回退最近一次有效 imported；没有有效 imported 时必须显示不可用。
- 展示版手工流程：准备并校验六文件包 → 管理员在“前端数据包”执行导入 → 核对 source=imported、Manifest/页面数量和日期范围 → 重启容器后复核持久化。自定义情报与邮件仍按环境配置在线，但导入不覆盖用户、审计、自定义情报/邮件数据库、资格名单、LLM 配置、`.env` 或其他 secrets；恢复 live 只能使用显式管理员操作，不要手工删除状态文件。
- 新增券商官网来源：在 `backend/broker_sources/` 增加 collector 与配置，并保持 `official > cfcpn > external` 选择契约及空源保护。
- 新增 App 来源：修改 `backend/config/broker_app_watch/brokers.yaml`，先运行 `check-config` 与 `dry-run`。
- 新增搜索能力：扩展 `qianfan_search.py` 的固定服务端适配，不把 Endpoint、Key 或任意请求参数开放给浏览器。

## 兼容与历史边界

- 正式前端只消费 `/api/dashboard-data/*` 的当前选定源；`/api/data/announcements`、`/api/app-releases` 保留为兼容/管理入口，新页面不得再接入。GET 由 live/imported 源选择器生成响应，不直接读取 `DASHBOARD_DATA_EXPORT_DIR`。
- `/api/ai-analysis` 仍是固定近 30 天全局 AI 摘要，和招采页当前筛选无关；页面已明确该口径。
- Session、任务互斥和 SSE 历史是单进程内存状态；重启失效、多 worker 不受支持，这是当前单机架构的明确边界。
- `dashboard_package.py` 与 LLM 表格构建器虽较大，但承载稳定业务规则；交接阶段不做大拆分，新增逻辑优先提取可测试纯函数。

## 最短交接流程

导出端生成并核对六文件 ZIP → 管理员在目标环境导入 → 检查 `/api/dashboard-data/manifest`
的 `source=imported`、日期范围与数量 → 重启容器后复核 `runtime/data/dashboard-data/`
中的 ZIP/来源状态。展示版不启动招采/App 采集；自定义情报和邮件继续使用原环境配置，
且不参与数据包同步。需要实时数据时由管理员显式恢复 `live`。

## 最小回归

1. 登录、申请账号、管理员创建用户；无 Token 为 401，非管理员为 403。
2. Pipeline 成功自动发布；空候选/低留存失败且正式 CSV 不变；任务取消后能再次启动。
3. 六文件 Export=Import：完整包可导入、Manifest/schema/hash/count 校验失败会拒绝；成功后 source 切到 imported，live 缺失时自动回退 imported，且重启后来源状态和六文件 ZIP 仍在 `DASHBOARD_DATA_EXPORT_DIR`。
4. 导入前后 users.db、audit.db、自定义情报/邮件数据库、资格名单、LLM 配置和 `.env` 的内容/mtime 不变；前端采购/App/AI 页面与 Manifest 数量一致。
5. 招采/App 数据包加载、筛选、详情、导出；空数据与 401 不白屏；生产验收核对 2026-01-01 至验收日的真实日期范围与记录数量。
6. 自定义情报搜索中/分析中/成功/空结果/分析失败五种状态，历史切换、重跑、重分析、PDF 终态限制。
7. SSE 首包 padding、分块解析、断线轮询兜底；生产 Compose 四服务及首页、health、version smoke。
