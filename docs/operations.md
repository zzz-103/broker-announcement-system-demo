# 运行与发布

## macOS 本地测试

在仓库根目录准备环境：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/api/requirements.txt
cd frontend && pnpm install && cd ..
cp .env.example .env
```

启动 FastAPI：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
```

启动前端：

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev
```

检查 `http://127.0.0.1:8000/api/health`，页面访问 `http://localhost:3000`。后端重启后内存 Token 会失效，需要重新登录。

App Watch 复用后端环境；仅检查配置和任务计划时，从仓库根目录执行：

```bash
.venv/bin/python -m backend.broker_app_watch.cli check-config
.venv/bin/python -m backend.broker_app_watch.cli dry-run
```

Windows 使用 `.venv\Scripts\python.exe -m backend.broker_app_watch.cli ...`。配置位于 `backend/config/broker_app_watch/`，运行数据位于 `backend/data/broker_app_watch/`。

App Watch 的可选定时刷新复用 `python -m backend.api.scheduler`，通过根 `.env` 的 `APP_WATCH_SCHEDULER_ENABLED` 和 `APP_WATCH_SCHEDULER_CRON` 控制；默认关闭。

## AI 自定义情报中心

在根 `.env` 配置百度千帆智能搜索，密钥只由 FastAPI 读取：

```env
BAIDU_QIANFAN_API_KEY=<server-side-api-key>
BAIDU_QIANFAN_TIMEOUT_SECONDS=120
CUSTOM_INTELLIGENCE_MAX_WORKERS=2
```

搜索接口固定为百度 `v2/ai_search/web_search` 和 `baidu_search_v2`，不允许浏览器或数据库覆盖 Endpoint。第一版仅支持 bce-v3 API Key，并固定使用 `Authorization: Bearer <API Key>`；上线前应在管理页执行连接测试。

主题与每次执行记录保存在 `USER_DB_PATH` 指向的现有数据库中；每个用户最多保留最近 30 条执行记录，新增或完成执行后自动删除创建时间最早的已结束记录。历史记录页面按 10 条一页提供分页翻阅。只有部署明确需要隔离时才设置 `CUSTOM_INTELLIGENCE_DB_PATH`；未配置不会生成第二个默认数据库。生产继续使用单 worker，执行状态由数据库保存，页面轮询恢复。

登录后访问 `http://localhost:3000/custom-intelligence`。系统先由共享 DeepSeek 生成 2–5 个短查询，每个查询调用一次百度普通搜索（最多 10 条），再按百度原始排名轮转合并，执行 URL/标题/provider 去重、可解析日期的时效过滤和每域最多 3 条控制，最终最多保留 15 条来源。报告篇幅只影响成文深度，不改变查询数量。Planner 失败时仅使用用户原始关注描述执行一次带明确标记的降级检索，不再执行固定分面补搜。管理员可在执行诊断中查看 queries、每轮数量、过滤统计、最终来源、request ID 与阶段错误，普通用户不可见。

如果页面提示服务不可用或分析失败，先在管理员“AI 技术配置”中检查共享 DeepSeek 的 `base_url`、`model` 和 API Key，并建议保持 `use_json_object: true`。Report V2 要求事实与分析绑定本次搜索的有效 source ID；核心判断失去有效依据时分析失败并保留搜索来源，不会用无引用文本冒充正式报告。

管理员保存的 DeepSeek 配置会原子写入 `LLM_CONFIG_OVERRIDE_PATH`（默认 `backend/data/llm_api_config.override.json`，不得纳入版本控制），并优先于旧的 `LLM_CONFIG_PATH`。该覆盖是全项目共享配置，会同时用于 AI 情报助手、招采 AI 分析、App Watch 和 LLM 结构化任务；旧配置文件仅作为未设置覆盖时的回退。百度 API Key、DeepSeek API Key 与网易 SMTP 授权码均可在管理页经管理员密码二次验证后查看和替换，连接测试与配置变更只记录不含凭据的安全审计信息。

邮件发送固定使用 `smtp.126.com:465` 和 SSL，SMTP 用户名必须与 `@126.com` 发件地址一致，登录只使用客户端授权码。普通用户最多选择 5 个收件人，可选择“研究简报”或“情报日报”模板，并选择 HTML + PDF、仅 HTML 或仅 PDF；公司域外地址必须再次确认。系统为每个收件人分别生成邮件，所有呈现形式始终复用已经持久化的同一份 Report V2，不会再次调用模型。

## 展示版：导入数据包手工流程

展示版只对招采/App 看板使用已经准备好的 dashboard-data，不运行爬虫、LLM、Pipeline
或 App Watch 采集。它仍然使用同一套 FastAPI/前端镜像，不新增部署模式环境变量；
自定义情报和邮件链路按本环境既有配置照常在线，不参与 dashboard-data 同步。

数据包必须是完整的六文件 Export=Import 包：
`manifest.json`、`overview.json`、`filters.json`、`tender_projects.json`、
`app_updates.json`、`ai_analysis.json`。不要把 CSV、SQLite、`.env`、LLM 配置或
自定义情报导出物混进包内。

1. 在受限的临时目录保存待导入包，先核对 Manifest 的 schema/version、六个文件名、
   SHA-256、字节数和记录数；确认包来自可信的生产导出。
2. 按正常生产 Compose 启动 `backend-api`、`frontend` 和 `gateway`；展示期间保持
   `backend-scheduler` 停止或不安排采集任务，不执行爬虫/LLM/Pipeline/App Watch 任务。
   自定义情报和邮件仍按本环境已有的百度、共享 LLM、SMTP、用户数据库配置运行；这些
   secrets 只保留在原受限路径，不进入导入包。首次部署仍需按发布脚本要求准备受限配置文件。
3. 以管理员身份在“管理控制台 → 前端数据包”执行导入。导入成功后，后端校验并原子保存
   六文件 ZIP 和来源偏好文件到 `DASHBOARD_DATA_EXPORT_DIR`，再将当前来源切换为
   `imported`。不要手工覆盖 `users.db`、`audit.db` 或其他运行数据库来“导入”看板。
4. 在界面和 `/api/dashboard-data/manifest` 核对来源状态为 `imported`，再打开采购看板、
   App 更新和 AI 分析页面确认数据可见；核对导入 ZIP 与来源偏好文件仍位于主机
   `<DeployDir>\runtime\data\dashboard-data\`。
5. 重建或重启容器后再次核对来源状态和 Manifest。生产 Compose 的
   `./runtime/data:/app/backend/data` 已覆盖 `DASHBOARD_DATA_EXPORT_DIR`，所以来源状态和
   导入 ZIP 应跨容器重建保留。

展示版需要恢复实时数据时，必须使用管理员界面提供的显式“恢复 live/实时数据”操作，
然后再启动调度器；不要通过删除导入文件、修改状态文件或替换用户数据库来切换来源。
服务默认来源是 `live`。若 live 文件缺失、损坏或校验失败，系统会自动回退到最近一次
有效的 imported 包；没有有效 imported 包时应明确显示数据不可用，而不是伪造空的生产事实。

## Windows 本地验证

Windows 使用与锁文件一致的 Corepack pnpm 9：

```powershell
cd <源码目录>\frontend
corepack pnpm@9.0.0 install --frozen-lockfile
.\node_modules\.bin\tsc.cmd -p tsconfig.json
.\node_modules\.bin\next.cmd build
```

## Windows 内网发布

源码仓库和生产运行目录分开。仓库根 `docker-compose.yml` 只用于后端开发，不是生产拓扑。首次建生产目录时，将仓库的 `deploy/docker-compose.example.yml` 复制为 `D:\broker-system\docker-compose.yml`，同时复制 `deploy/nginx.conf`；准备 `runtime/config/llm_api_config.json`、`runtime/config/user_qualification.csv`、`.env` 和 runtime 数据目录。之后统一由 `scripts/deploy-release.ps1` 发布。

### 拉取后最快部署

以后发布新版本，直接在开发目录执行以下命令；把 `1.6.0` 替换成目标版本号即可：

```powershell
cd D:\broker-announcement-system-demo
git pull --ff-only
.\scripts\deploy-release.ps1 -Version 1.6.0 -DeployDir D:\broker-system
```

也可以使用生产目录中的转发脚本：

```powershell
cd D:\broker-system
.\deploy-release.ps1 -Version 1.6.0
```

发布脚本会校验源码已同步到 `origin/master`、构建两个镜像、更新生产 `.env` 的
`BROKER_VERSION`、重建四个服务，并检查网关健康状态和 `version.json`。因此不要在生产目录执行 `git pull`，也不要跳过脚本直接重启容器。

生产前确认：

- `.env` 已设置真实管理员密码、调度器 Token 和 LLM 配置。
- `.env` 已设置 `BROKER_VERSION` 与 `BROKER_PUBLIC_URL`；Compose 校验能看到 backend-api、backend-scheduler、frontend、gateway 四项服务。
- `FRONTEND_ORIGIN`、`FRONTEND_DIST_PATH` 和数据挂载目录正确。
- 完整系统的 live 数据位于 `runtime/data/announcement_table.csv`、
  `runtime/app-watch-data/exports/app_releases.csv` 和（可选）`runtime/data/ai-analysis.json`；
  展示版导入包及源状态位于 `runtime/data/dashboard-data/`。App Watch 的 raw/processed
  历史只放在 `runtime/app-watch-data/`，不要复制到公开导出包。
- 导入或升级时只允许校验后的 dashboard-data 六文件 ZIP 与来源状态进入
  `runtime/data/dashboard-data/`；
  `users.db`、`audit.db`、自定义情报/邮件数据库、资格名单、`.env`、LLM 配置和其他 secrets
  必须保留在各自受限路径，不得由导入流程覆盖。
- FastAPI 保持单 worker，确保 Session、任务锁、SSE 和缓存一致。
- 网关对 HTML 和 `version.json` 使用 `no-store`，哈希静态资源使用长期缓存。
- 生产验收不得只看页面“有数据”：以真实数据为准核对 2026-01-01 至验收日的日期范围、
  招采与 App 的实际记录数量、Manifest 中的 SHA-256/record_count，以及页面汇总和筛选后
  记录是否一致。验收记录应注明当前来源是 live 还是 imported；演示种子或旧缓存不能替代
  2026 年 1 月以来的真实数量。

## 数据包导出

管理员可以在管理控制台“前端数据包”导出 ZIP；无界面时在仓库根目录运行：

```bash
python scripts/export_dashboard_data.py --zip
```

默认输出 `backend/data/dashboard-data/` 和同级 ZIP；正式前端通过 API 读取源选择逻辑
返回的当前数据。

这里的“读取”指 API 先解析 live/imported 源选择，再返回当前源的标准化数据；GET 不会
把 `DASHBOARD_DATA_EXPORT_DIR` 当作静态目录直接读取。该目录同时承担 Export=Import
六文件包和源状态的持久化位置，生产由 `runtime/data` volume 覆盖。导入成功后来源切换
为 imported；live 恢复或 live 暂时不可用时，按源选择规则切换/回退，不要手工修改导出文件。

## 关键验证

```bash
./.venv/bin/python -m unittest discover -s backend/api/tests -p 'test*.py'
cd frontend && pnpm run ts-check && pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= pnpm build
```

真实爬虫、LLM、外部网站和 Docker 发布必须在具备相应配置的环境单独验收；本机没有生产数据时不要声称已完成真实链路验证。

## 常见问题

- 页面无法调用 API：确认 FastAPI 已启动，且 `FRONTEND_ORIGIN` 包含当前前端地址。
- 401：后端重启使旧 Token 失效，重新登录即可。
- 409：已有互斥任务或导出操作运行中。
- 自定义情报 409：同一用户已有 pending/running 执行，等待完成后再提交。
- 自定义情报 503：后端未配置百度 API Key，或情报数据库暂不可用；504 表示上游超时。
- 看板显示 imported 或自动回退：先检查 `runtime/data/dashboard-data/` 是否包含校验后的
  六文件 ZIP、来源状态和有效 Manifest，再检查 live CSV/JSON 的日期范围与权限；不要直接
  删除导入包或数据库文件。
- 导入后重启数据消失：检查部署 Compose 是否仍挂载
  `./runtime/data:/app/backend/data`，以及 `DASHBOARD_DATA_EXPORT_DIR` 是否仍指向该挂载内目录。
- 修改 `.env` 或前端环境变量后：重启对应服务；修改正式前端后重新生成 `out/`。
