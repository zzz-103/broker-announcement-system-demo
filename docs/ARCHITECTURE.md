# 系统架构与模块边界

## 整体架构

```text
浏览器
  └─ HTTP / Bearer SSE
     └─ Nginx Gateway（生产）
        ├─ Next.js 静态导出（frontend/out）
        └─ FastAPI（单 worker）
           ├─ 内存 Session、任务状态、互斥锁、SSE 日志
           ├─ SQLite：用户、审计、自定义情报、邮件配置
           ├─ CSV / JSON：招采、App 更新、AI 摘要、dashboard-data
           ├─ subprocess：采集、LLM、匹配、App Watch
           └─ 外部网站、百度千帆、共享 LLM、SMTP

独立 APScheduler 进程
  └─ X-Scheduler-Token HTTP → FastAPI 内部任务接口
```

当前代码没有 Redis、Celery、Kafka 或业务数据库服务。生产 Compose 是 `backend-api`、`backend-scheduler`、`frontend`、`gateway` 四服务；FastAPI 必须单 worker，因为 Session、任务锁和日志历史保存在进程内。

## 主要模块

| 模块 | 控制目录 | 职责与边界 |
| --- | --- | --- |
| 正式前端 | `frontend/src/app/`、`frontend/src/features/` | 登录、招采、App 更新、自定义情报和管理界面；只调用 FastAPI |
| API 与管理 | `backend/api/routes/` | 账号/审计、任务/SSE、数据集、AI、数据包和情报接口 |
| 任务运行 | `backend/api/job_manager.py`、`job_commands.py` | 固定可信子进程、互斥、取消、日志与 Pipeline 阶段 |
| 金采网采集 | `backend/python-http-www-cfcpn-com-jcw/` | 公告列表、详情和 Markdown 输出 |
| 官网采集 | `backend/broker_sources/` | 券商官网 collector、来源选择和空结果保护 |
| 公告结构化 | `backend/llm_table/` | Markdown → 候选 CSV/JSONL/XLSX |
| 公告匹配 | `backend/matching/` | 规则候选、LLM 双重核验、增量状态和保守合并 |
| App Watch | `backend/broker_app_watch/` | 来源采集、解析、归一化、LLM 补充、原子导出 |
| 自定义情报 | `custom_intelligence_*`、`qianfan_search.py`、`intelligence_*` | 查询规划、联网搜索、Report V2、PDF、邮件、管理员配置 |
| 数据包 | `dashboard_package.py`、`dashboard_package_import.py` | 标准化、校验、Export=Import、live/imported 源选择 |
| 发布 | `scripts/deploy-release.ps1`、`deploy/` | Windows 镜像构建、四服务发布、健康检查和回滚 |

`backend/api/main.py` 只装配中间件、领域路由和静态前端；业务逻辑留在各服务模块。`frontend/src/lib/api/` 是前端唯一 API/SSE 客户端层，`shared/dashboard-data/contracts.ts` 是看板契约的 TypeScript 定义。

## 数据流

### 招采数据

```text
金采网 + 已启用券商官网
→ output/selected/{procurement,result}/notices/*.md
→ llm_table 候选 CSV
→ matching 规则候选 / LLM 复核 / 增量状态
→ project_merger 合并
→ publication_service 留存校验、备份、原子发布
→ backend/data/announcement_table.csv
→ dashboard_package 标准化
→ /api/dashboard-data/*
```

完整 Pipeline 自动发布。单独 LLM 任务完成后由管理员显式“更新看板”。候选为空或低于 `PUBLISH_MIN_RETAIN_RATIO` 时保留上一版正式 CSV。

### App 更新

```text
backend/config/broker_app_watch/brokers.yaml
→ HTTP collector 与站点解析器
→ raw Markdown / normalized candidates
→ 共享 LLM 补充
→ app_releases.csv 原子替换
→ dashboard-data app_updates
```

正式 CSV 保留平台和采集快照作为来源证据；dashboard-data 在展示边界按“券商 + App + 规范版本”合并版本事件，跨平台记录显示为全平台。摘要只接受明确的新增、优化、修复或安全/合规变化，运行环境、文件大小、下载信息、产品介绍和宣传内容不进入看板。Apple App Store 当前版本通过固定 App ID 的公开 Lookup API 采集，来源仍统一配置在 `brokers.yaml`。

### 自定义情报与邮件

```text
用户关注描述
→ 共享 LLM 查询规划
→ 百度千帆 Web Search
→ 来源去重与筛选
→ 共享 LLM Report V2
→ SQLite 持久化
→ HTML / PDF
→ 可选的管理员配置 SMTP（默认 smtp.csco.com.cn:465 SSL）
```

百度、LLM、SMTP 凭据只在服务端环境或管理员受限配置中保存；dashboard-data 导入不携带这些内容。

### 数据包导入与导出

标准包固定包含 `manifest.json` 和 5 个数据集：`overview.json`、`filters.json`、`tender_projects.json`、`app_updates.json`、`ai_analysis.json`。当 Manifest 标记相应基线可用时，还会包含 `matching_baseline.json` 和 `app_watch_baseline.csv`；后者保存 App 内容哈希、来源身份与结构化历史，供迁移后的设备跳过未变化来源，避免重复调用 LLM。

导出对内容生成字节数、SHA-256、记录数和 Schema 元数据。导入先预览并校验文件名、大小、哈希、结构和记录数，再保留原始导入 ZIP、初始化可演进当前工作包、恢复可选招采匹配和 App Watch 基线并将源切换为 `imported`。后续 App Watch、完整 Pipeline 或 AI 分析成功时只合并对应数据集到当前工作包，未更新的数据集继续沿用导入基线；原始导入 ZIP 不被任务覆盖。前端始终通过源选择器读取 live/imported 当前源；导入不覆盖用户、审计、情报、邮件、资格名单、`.env` 或 LLM 配置。

## 持久化与配置

- `backend/data/announcement_table.csv`：正式招采数据
- `backend/data/broker_app_watch/exports/app_releases.csv`：App 更新
- `backend/data/ai-analysis.json`：全局 AI 摘要缓存
- `backend/data/dashboard-data/`：导出/导入包与源偏好
- `backend/data/users.db`：用户及默认自定义情报存储
- `backend/data/audit.db`：审计
- `backend/data/staging/`：结构化与匹配中间数据

所有路径可由环境变量覆盖，并通过项目根目录与 `pathlib.Path` 解析。生产用宿主机 `runtime/` volume 持久化；Git 不保存运行数据或私密配置。

## 外部依赖

- 数据来源：金采网、`backend/broker_sources/sources.json` 中的券商官网、App Watch 配置中的公开页面/API
- AI：`backend/config/llm_api_config.json` 或管理员覆盖配置指定的 OpenAI 兼容服务；百度千帆 Web Search
- 邮件：管理员可配置 SMTP 主机、端口及 SSL；默认企业邮件为 `smtp.csco.com.cn:465` SSL，也支持明确选择非 SSL 传输
- 运行库：FastAPI/Uvicorn、requests/httpx、BeautifulSoup、pandas/openpyxl、OpenAI SDK、APScheduler、ReportLab、RapidOCR；前端为 Next.js/React/Zustand/TanStack Table/ECharts

部署网络清单属于受控交接附件，不随源码版本控制。若交接包提供本地 `docs/network-whitelist.csv`，应结合目标环境逐项确认；该清单不代表所有来源在离线验收中均已真实联调。

## 稳定性与安全边界

- Bearer Session 重启失效；管理员任务和源切换受角色与互斥控制。
- SSE 断开不取消后端任务；取消必须调用专用接口。
- 文件写入采用同目录临时文件与 `os.replace`；缓存失败不破坏上一版。
- 浏览器不能传入命令、路径、Endpoint 或凭据；错误响应不包含 traceback 或服务器绝对路径。
- 当前架构面向内部单机首版；扩展新模块时复用现有认证、任务、配置和数据包层。
