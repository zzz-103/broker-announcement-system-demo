# 安装、运行与交接操作手册

## 1. 环境准备

本地开发需要 Git、Python 3.11、Node.js >=20.9、Corepack、pnpm 9。生产式 Windows 部署另需 Docker Engine / Docker Desktop（支持 Compose v2）。当前系统不需要 Redis、Celery、Kafka 或外部数据库服务。

外部采集、百度搜索、共享 LLM 和邮件仅在配置真实凭据并开放对应网络后可用；离线启动和数据包导入不依赖它们。

## 2. 第一次 Clone

```bash
git clone https://github.com/zzz-103/broker-announcement-system-demo.git
cd broker-announcement-system-demo
cp .env.example .env
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -c requirements-lock.txt
corepack prepare pnpm@9.0.0 --activate
cd frontend
pnpm install --frozen-lockfile
cd ..
```

Windows PowerShell：

```powershell
git clone https://github.com/zzz-103/broker-announcement-system-demo.git
cd broker-announcement-system-demo
Copy-Item .env.example .env
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -c requirements-lock.txt
corepack prepare pnpm@9.0.0 --activate
cd frontend
pnpm install --frozen-lockfile
cd ..
```

编辑根 `.env`：

- 必须替换 `ADMIN_PASSWORD` 和 `SCHEDULER_TOKEN`，两者不要相同。
- 本地开发保留 `FRONTEND_ORIGIN` 的 3000/5000 配置；API 示例使用 8000，Docker 开发栈映射到 5000。
- 用户申请需把 `backend/config/user_qualification.example.csv` 复制为被忽略的 `user_qualification.csv` 并填真实名单。
- 只有启用对应功能时才提供 LLM、百度和 SMTP 配置；密钥不得加 `NEXT_PUBLIC_` 前缀。

## 3. 本地启动与停止

终端一，从仓库根启动 API：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
```

终端二启动前端：

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev
```

可选终端三启动调度器：

```bash
.venv/bin/python -m backend.api.scheduler
```

打开 `http://localhost:3000`，检查 `http://127.0.0.1:8000/api/health` 和 `http://127.0.0.1:8000/docs`。用 `Ctrl+C` 停止各进程。后端重启会使内存 Session 失效，需要重新登录。

App Watch 离线配置检查：

```bash
.venv/bin/python -m backend.broker_app_watch.cli check-config
.venv/bin/python -m backend.broker_app_watch.cli dry-run
```

### 管理员技术配置与 SMTP

百度检索 API、共享 LLM API 和 SMTP 发件服务统一在“管理控制台 → 情报技术配置”维护。SMTP 配置步骤：

1. 填写 SMTP 主机、端口并选择是否使用 SSL；企业邮箱推荐 `smtp.csco.com.cn`、465、SSL。
2. 用户名和发件地址填写同一个有效邮箱；输入邮箱授权码，保存后再点击“测试已保存配置”。连接测试只完成 SMTP 登录，不发送邮件。
3. GET 配置只返回授权码掩码；查看完整授权码需要当前管理员密码二次验证。修改授权码后应立即保存，避免明文长时间停留在页面状态。
4. 管理页配置保存在 `USER_DB_PATH`（或独立的 `CUSTOM_INTELLIGENCE_DB_PATH`），优先于 `.env` 回退值；生产必须持久挂载该数据库。dashboard-data ZIP 不携带这些 API 或邮件凭据，因此新 Clone 必须重新注入或通过管理页配置。

根 `.env` 的 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USE_SSL`、`SMTP_USERNAME`、`SMTP_FROM_ADDRESS`、`SMTP_AUTHORIZATION_CODE` 只用于尚无数据库配置时的服务端回退。默认关闭邮件；未配置完整凭据前不要启用。非 SSL 的 25 端口仅在邮件服务器和网络策略明确允许时使用。

## 4. 从数据包恢复业务数据

新环境优先导入，不要重跑全部历史爬虫。

### 导出端

管理员在“管理控制台 → 前端数据包”导出 ZIP，或从仓库根运行：

```bash
.venv/bin/python scripts/export_dashboard_data.py --zip
```

包内必须有 Manifest 和 5 个数据集；若 Manifest 声明匹配基线可用，还应有 `matching_baseline.json`。包不含 SQLite、用户、审计、自定义情报、邮件配置、资格名单、`.env` 或 LLM 密钥。

### 新环境导入

1. 启动 API 和前端，以管理员登录。
2. 打开“管理控制台 → 前端数据包”，选择可信 ZIP；先预览警告，再确认导入。
3. 导入成功后检查来源为 `imported`，打开招采、App 更新和 AI 摘要页面，核对 Manifest 的记录数和日期范围。
4. 重启 API，再次确认来源与数据仍存在。

导入包和源偏好保存在 `DASHBOARD_DATA_EXPORT_DIR`。恢复实时数据必须使用管理页的“恢复 live”操作；不要手改状态文件或替换用户数据库。

## 5. 正式脚本与入口

长期人工运维脚本只保留在根 `scripts/`：

| 入口 | 用途 | 使用方式 |
| --- | --- | --- |
| `scripts/export_dashboard_data.py` | 无界面导出标准数据包 | 从仓库根用当前后端 Python 执行 |
| `scripts/deploy-release.ps1` | Windows 构建、发布、健康检查与回滚 | 必须显式传 `-Version` 和 `-DeployDir` |

属于业务模块的 CLI 保留在对应包内：`python -m backend.api.scheduler`、`python -m backend.broker_app_watch.cli`、`python -m backend.broker_sources.cli`。金采网、LLM 结构化和 matching 模块是 Pipeline 的内部阶段，由 `JobCommandFactory` 以固定参数调用；日常操作优先使用管理页任务，不复制第二套包装脚本。

前端命令统一由 `frontend/package.json` 管理：`dev`、`build`、`ts-check`、`lint:build`、`validate`。使用 `pnpm install --frozen-lockfile`，以提交的 `frontend/pnpm-lock.yaml` 为准。`frontend/next-env.d.ts` 由 Next.js 按 dev/build 输出目录自动生成并已忽略，不要重新加入 Git。仓库不维护重复的 `.sh`、`.cmd` 或旧平台启动包装。

## 6. 日常开发与验证

```bash
.venv/bin/python -m pytest -q
cd frontend
pnpm run ts-check
pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= pnpm build
cd ..
RUN_FRONTEND_STATIC_SMOKE=1 .venv/bin/python -m pytest -q backend/api/tests/test_route_ownership.py -k static_export
```

生产构建生成 `frontend/out`。最后一条显式 smoke 会检查首页、`/admin`、`/app-updates`、`/custom-intelligence` 与 `/version.json`；若产物不存在则直接失败。FastAPI 在该目录存在时可同源托管静态页面；开发时通常仍使用 Next dev。查看任务日志使用管理页 SSE；查看服务日志使用启动终端或 `docker compose logs -f <service>`。

修改 `.env` 后重启 API/调度器；修改前端公开环境变量后重新构建。真实采集、LLM、搜索与邮件不得用离线测试结果替代真实联调结论。

## 7. Windows 生产部署

源码目录与生产运行目录分开。首次准备 `D:\broker-system`：

1. 将 `deploy/docker-compose.example.yml` 复制为 `D:\broker-system\docker-compose.yml`。
2. 将 `deploy/nginx.conf` 复制到同目录。
3. 创建 `.env`，设置 `BROKER_VERSION`、`BROKER_PUBLIC_URL`、管理员密码、调度 Token 和所需配置。
4. 创建 `runtime\data`、`runtime\scraper-output`、`runtime\app-watch-data`、`runtime\config`。
5. 在 `runtime\config` 放置受限的 `llm_api_config.json` 和 `user_qualification.csv`。

发布前确保源码在 `master`、工作树干净并与 `origin/master` 同步；`frontend/package.json` 版本必须等于发布版本：

```powershell
cd D:\broker-announcement-system-demo
git pull --ff-only
.\scripts\deploy-release.ps1 -Version 1.7.1 -DeployDir D:\broker-system
```

脚本构建 backend/frontend 镜像，验证四个 Compose 服务，更新生产 `.env`，重建容器，检查 API、首页和 `version.json`，失败时尝试回滚。生产访问默认为 `http://localhost:8080`。不要在生产目录执行 `git pull`，也不要绕过脚本直接更新版本。

根 `docker-compose.yml` 只有 backend-api/backend-scheduler，适合后端开发验证；完整生产拓扑以 `deploy/docker-compose.example.yml` 为准。FastAPI 始终保持一个 worker。

## 8. 网络与凭据

联网目标清单见 [network-whitelist.csv](network-whitelist.csv)。上线前以一次低频真实请求核对重定向和动态图片 CDN，只放行实际目标。金采网及部分来源使用 HTTP 或禁用系统代理，按清单确认网络策略。

`.env`、`backend/config/llm_api_config.json`、管理员覆盖配置和 SMTP 授权码只能通过受限文件/挂载或密钥管理注入。若凭据曾出现在共享目录、终端输出或历史提交中，立即轮换；删除当前代码不使用的旧密钥变量。

版本交接以 Git 提交、可信 dashboard-data 数据包和受控配置三者为准；数据包不替代凭据或用户/审计数据库备份。

交接审阅确认旧 Git 历史曾跟踪 `.env` 和 `backend/config/llm_api_config.json`，其中出现过非空管理员密码、调度 Token 和 LLM API Key 字段。当前版本已忽略这些文件，但“删除当前文件”不能使历史凭据恢复安全；部署前必须轮换相关凭据。若组织决定清理 Git 历史，应单独制定停机、备份、强制推送和所有 Clone 重新同步方案，不要在日常发布中直接改写历史。

## 9. 常见故障

- 后端无法启动：确认虚拟环境依赖完整、从仓库根运行、`.env` 值合法、8000 端口未占用；可先执行 Python 测试和 `/api/health`。
- 前端无法连接 API：检查 `NEXT_PUBLIC_API_BASE_URL`、`FRONTEND_ORIGIN`、端口和浏览器 401；后端重启后需重新登录。
- 数据不可用：查看 `/api/dashboard-data/manifest`、管理页 source 状态和 `DASHBOARD_DATA_EXPORT_DIR`；不要把导出目录当静态数据目录。
- 导入失败：使用系统导出的 ZIP，检查 Manifest/schema/hash/count、可选 matching baseline 和 64 MiB 限制；不要自行重打包混入数据库或密钥。
- 导入后重启丢失：生产 Compose 必须挂载 `./runtime/data:/app/backend/data`，且 `DASHBOARD_DATA_EXPORT_DIR` 位于该挂载内。
- 任务 409：已有互斥任务或数据包操作；等待或通过管理页取消对应任务。
- 搜索/LLM 失败：在管理员 AI 技术配置检查服务端 Key、模型、base URL 和连接测试；503 常见于未配置，504 为上游超时。
- 邮件失败：确认已先保存配置，主机/端口/SSL 与邮件服务要求一致，用户名与发件地址相同，授权码有效且目标端口已放行；企业邮箱推荐 `smtp.csco.com.cn:465` SSL。
- Docker 构建/启动失败：确认 Docker Compose v2、运行目录模板/受限配置文件齐全，执行 `docker compose config` 后查看四服务日志。本项目没有 Redis/Celery，勿按旧架构排查。

## 10. 最小 Smoke Test

1. health 200；首页、`/admin`、`/app-updates`、`/custom-intelligence` 可打开。
2. 正确管理员登录；无 Token 为 401；普通用户不能进入管理员接口。
3. 导入预览与导入成功，source 为 imported；招采/App/AI 页面记录数与 Manifest 一致。
4. 导出 ZIP 可再次通过预览校验；API 重启后 imported 源仍可读取。
5. 管理任务状态、SSE 日志与取消入口可访问，但不在无凭据环境启动真实采集/LLM。

用户/审计/自定义情报 SQLite 的初始化由 API 启动完成。新环境的数据包恢复不会恢复这些私有数据，这是安全边界而非导入缺陷。

## 11. 最近一次从零交接验收

基线提交 `8193c8f`（2026-08-12）在全新临时 Clone 中按当时版本的安装说明完成了以下验证：

- 安装 Python 依赖并按 pnpm frozen lockfile 安装前端依赖后，执行了后端测试、前端检查和空 API Base URL 的生产构建；本轮新增的 `requirements-lock.txt` 记录该交接环境的直接依赖版本基线，具体测试数量不作为长期承诺。
- 启动 FastAPI 后，health、管理员登录、无效 Token 401、用户/审计/自定义情报 SQLite 初始化及四个静态页面通过。
- 导入一份来自另一台机器的标准 ZIP：预览无警告，恢复 1,425 条招采、69 条 App 更新和 AI 分析；该包未声明可选 matching baseline，故未恢复基线是预期行为。
- 重启 API 后仍以 imported 为活动源；导出的新 ZIP 可再次通过预览校验。前台会按产品口径筛选记录，页面数字不必等于 Manifest 全量数，管理页数据源卡片应与 Manifest 一致。
- 在明确授权和受限配置下，各执行一次最小真实 LLM 连通测试、百度搜索连通测试、单条金采网采集、单券商 App Watch 采集及单文件 LLM 结构化，均成功；未发送测试邮件，也未运行会发布正式数据的完整 Pipeline。
- 浏览器登录、招采、App 更新、情报助手与管理控制台均可访问，控制台无 error。

该次环境没有 Docker 与 PowerShell，因此 Windows 四服务 Compose、发布脚本、SMTP 发送和生产网络策略仍须在目标 Windows 主机验收。以上记录用于证明命令和恢复链路曾按日期实测，不替代以后版本或生产环境的复测。
