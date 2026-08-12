# 安装、运行与交接操作手册

本文面向第一次接手项目、机器上没有本仓库运行环境的维护者。除明确标注“可选”或“生产”的步骤外，请按顺序执行，不要跳过成功标志检查。

## 1. 开始前先拿齐交接物

在运行命令前，确认以下四项：

1. 可访问的 Git 仓库地址、交付分支和完整提交号。远端 Clone 只能取得已经推送的提交；“交付人本机工作树干净”不代表本地提交已经在远端。
2. 一份由本系统导出的可信 `dashboard-data.zip`。新 Clone 不包含招采、App 更新和 AI 摘要等业务运行数据。
3. 受控的运行配置或凭据清单。至少需要新环境自己的管理员密码和调度 Token。
4. 若需要恢复用户、审计、自定义情报或管理员技术配置，另行取得经过批准的 SQLite 备份及恢复说明。dashboard-data ZIP 不包含这些数据。

交接边界如下：

- Git 提交负责源码、测试、文档和非敏感示例配置。
- dashboard-data ZIP 负责 5 个标准看板数据集和可选 matching baseline。
- `.env`、LLM 配置、SMTP 授权码、资格名单和 SQLite 通过受控渠道单独交付。
- 不要直接复制上一位维护者的整个开发目录；其中可能混有虚拟环境、缓存、日志和本机路径。

## 2. 准备工具并检查版本

正式推荐版本：

- Git：可正常 clone/pull；
- Python：3.11；
- Node.js：至少 20.9；
- Corepack：可用；
- pnpm：由 Corepack 按项目声明提供 9.0.0，不要求全局另装；
- Docker：只有生产式 Windows Compose 部署需要。

macOS/Linux 终端执行：

```bash
git --version
python3.11 --version
node --version
corepack --version
```

Windows PowerShell 执行：

```powershell
git --version
py -3.11 --version
node --version
corepack --version
```

成功标志：四条命令都能输出版本，Python 为 3.11.x，Node 不低于 20.9。若 `python3.11` 或 `py -3.11` 不存在，先安装 Python 3.11；不要把系统 Python 目录复制进项目。若 `corepack` 不存在，使用包含 Corepack 的 Node 发行方式补齐后再继续。

## 3. 从空目录 Clone 并核对交付提交

选择一个新的父目录，不要 clone 到旧项目目录里面。

macOS/Linux：

```bash
cd ~/work
git clone https://github.com/zzz-103/broker-announcement-system-demo.git
cd broker-announcement-system-demo
git rev-parse HEAD
git status --short
```

Windows PowerShell 示例：

```powershell
Set-Location D:\work
git clone https://github.com/zzz-103/broker-announcement-system-demo.git
Set-Location broker-announcement-system-demo
git rev-parse HEAD
git status --short
```

逐项确认：

1. `git rev-parse HEAD` 等于交付人给出的完整提交号；如果不同，先确认分支和提交是否已经推送，不要在错误版本上继续部署。
2. `git status --short` 没有任何输出。此时仓库不应有 `.env`、`.venv`、`frontend/node_modules`、`frontend/out` 或 `frontend/.next`。
3. 根目录存在 `requirements.txt`、`requirements-lock.txt`、`frontend/pnpm-lock.yaml`、`.env.example`、`README.md` 和本手册。

后续所有后端命令都从仓库根执行；所有前端命令会明确要求先进入 `frontend/`。

## 4. 创建 Python 虚拟环境并安装固定依赖

### 4.1 macOS/Linux

从仓库根执行：

```bash
python3.11 -m venv .venv
.venv/bin/python --version
.venv/bin/python -m pip install -r requirements.txt -c requirements-lock.txt
.venv/bin/python -m pip check
```

### 4.2 Windows PowerShell

从仓库根执行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe --version
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -c requirements-lock.txt
.\.venv\Scripts\python.exe -m pip check
```

成功标志：安装命令退出码为 0，最后一条显示 `No broken requirements found.`。`requirements.txt` 声明直接依赖范围，`requirements-lock.txt` 作为 constraints 固定交接验收版本；不要只安装其中一个文件，也不要把 lock 当成 `-r` 单独安装。

若公司网络下载大 wheel 较慢，可以只增加读取超时后重试：

```bash
.venv/bin/python -m pip install --timeout 300 -r requirements.txt -c requirements-lock.txt
```

Windows 将 `.venv/bin/python` 换成 `.\.venv\Scripts\python.exe`。网络超时不等于依赖冲突；只有命令最终退出 0 才算安装成功。不要为绕过一次网络问题擅自修改锁定版本。

## 5. 安装前端依赖

macOS/Linux：

```bash
cd frontend
corepack pnpm --version
corepack pnpm install --frozen-lockfile
cd ..
```

Windows PowerShell：

```powershell
Set-Location frontend
corepack pnpm --version
corepack pnpm install --frozen-lockfile
Set-Location ..
```

成功标志：`corepack pnpm --version` 显示 `9.0.0`，安装命令退出码为 0。必须保留 `--frozen-lockfile`；如果提示 lockfile 与 `package.json` 不一致，应停止并让代码维护者修复提交，不要在交接机器上临时重写 lockfile。

项目的 `frontend/next-env.d.ts`、`.next/`、`out/` 和 `node_modules/` 都是本地生成物并已忽略。Next.js 在 dev/build 间重写 `next-env.d.ts` 是正常行为，不要把它重新加入 Git。

## 6. 创建并填写本机配置

### 6.1 复制安全模板

macOS/Linux：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

用文本编辑器打开根 `.env`，至少完成以下修改：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请替换为本环境密码
SCHEDULER_TOKEN=请替换为另一个不同的值
```

不要把上面的中文占位文本或示例 `change-me` 当作真实值。`ADMIN_PASSWORD` 与 `SCHEDULER_TOKEN` 必须不同。第一次本地验收只启动 API 时，不必启动 scheduler；也可以暂时把 `SCHEDULER_ENABLED=false`，待调度联调时再启用。

保留本地前端来源：

```dotenv
FRONTEND_ORIGIN=http://localhost:3000,http://127.0.0.1:3000,http://localhost:5000
```

初次离线启动不需要填写百度、LLM 或 SMTP 凭据。保持以下功能关闭或留空即可：

- `BAIDU_QIANFAN_API_KEY=`；
- SMTP 用户名、发件地址和授权码留空；
- `CUSTOM_INTELLIGENCE_EMAIL_ENABLED=false`；
- 不创建真实 `backend/config/llm_api_config.json`，除非已经通过受控渠道拿到配置。

若要启用用户申请，再复制资格名单模板并用真实受控名单替换示例：

```bash
cp backend/config/user_qualification.example.csv backend/config/user_qualification.csv
```

Windows 使用：

```powershell
Copy-Item backend\config\user_qualification.example.csv backend\config\user_qualification.csv
```

配置完成后执行：

```bash
git status --short
```

成功标志：仍然没有输出。`.env`、真实资格名单、运行数据库和构建产物都应被忽略。若这里出现这些文件，先停止并检查路径，不要提交凭据或运行数据。

## 7. 在启动服务前完成离线验收

以下命令不调用真实爬虫、搜索、LLM 或 SMTP。

### 7.1 后端测试

macOS/Linux：

```bash
.venv/bin/python -m pytest -q
```

Windows PowerShell：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

成功标志：pytest 最终退出码为 0。通过数量会随版本变化，不要把某次数字当作长期承诺；默认跳过需要生产静态产物的显式 smoke 是预期行为。

### 7.2 前端类型检查、lint 和生产构建

macOS/Linux：

```bash
cd frontend
corepack pnpm run ts-check
corepack pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= corepack pnpm build
cd ..
```

Windows PowerShell：

```powershell
Set-Location frontend
corepack pnpm run ts-check
corepack pnpm run lint:build
$env:NEXT_PUBLIC_API_BASE_URL=""
corepack pnpm build
Remove-Item Env:NEXT_PUBLIC_API_BASE_URL
Set-Location ..
```

空 `NEXT_PUBLIC_API_BASE_URL` 表示生产静态页面与 FastAPI 同源。成功标志：类型检查和 lint 退出 0，构建输出列出 `/`、`/admin`、`/app-updates`、`/custom-intelligence`，并生成 `frontend/out`。

### 7.3 显式生产静态页面 smoke

macOS/Linux：

```bash
RUN_FRONTEND_STATIC_SMOKE=1 .venv/bin/python -m pytest -q backend/api/tests/test_route_ownership.py -k static_export
```

Windows PowerShell：

```powershell
$env:RUN_FRONTEND_STATIC_SMOKE="1"
.\.venv\Scripts\python.exe -m pytest -q backend/api/tests/test_route_ownership.py -k static_export
Remove-Item Env:RUN_FRONTEND_STATIC_SMOKE
```

成功标志：该 smoke 通过，并检查 `/`、`/admin`、`/app-updates`、`/custom-intelligence` 和 `/version.json`。若 `frontend/out` 不存在，它会明确失败；先重新执行生产构建，不要把 smoke 改回静默跳过。

### 7.4 App Watch 离线配置检查

macOS/Linux：

```bash
.venv/bin/python -m backend.broker_app_watch.cli check-config
.venv/bin/python -m backend.broker_app_watch.cli dry-run
```

Windows 将 Python 路径替换为 `.\.venv\Scripts\python.exe`。成功标志：配置读取成功，dry-run 列出计划来源并明确“不发起网络请求”。

## 8. 第一次启动：先用单进程 FastAPI 验收

完成生产构建后，FastAPI 会同源托管 `frontend/out`。这是一条最简单的首次启动链路。

在终端一、仓库根执行：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Windows PowerShell：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --workers 1
```

不要把 `--workers 1` 改成多 worker。Session、任务状态、互斥锁和日志在进程内。

看到 `Application startup complete` 后，在浏览器逐个打开：

1. `http://127.0.0.1:8000/api/health`：应返回 `{"status":"ok"}`；
2. `http://127.0.0.1:8000/docs`：应显示 OpenAPI 页面；
3. `http://127.0.0.1:8000/`；
4. `http://127.0.0.1:8000/admin`；
5. `http://127.0.0.1:8000/app-updates`；
6. `http://127.0.0.1:8000/custom-intelligence`；
7. `http://127.0.0.1:8000/version.json`。

也可在终端二检查 health：

```bash
curl --fail http://127.0.0.1:8000/api/health
```

Windows PowerShell：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

使用 `.env` 中的管理员用户名和密码登录。第一次启动和首次登录会按需创建被忽略的 `backend/data/users.db` 和 `backend/data/audit.db`；这是正常初始化，不要加入 Git。

按 `Ctrl+C` 停止 API，再执行同一启动命令一次。health 和 `/admin` 再次可访问才算重启链路通过。后端重启会清空内存 Session，浏览器需要重新登录。

## 9. 日常开发：后端和 Next.js 分两个终端

需要热更新时，不使用上一节的单端口方式。

终端一，从仓库根启动 FastAPI：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
```

Windows：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
```

终端二，进入前端目录：

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 corepack pnpm dev
```

Windows：

```powershell
Set-Location frontend
$env:NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:8000"
corepack pnpm dev
```

打开 `http://localhost:3000`。依次确认四个页面可打开，浏览器请求指向 8000 端口 API。两个终端都用 `Ctrl+C` 停止。若 3000 已占用，可临时设置 `PORT=3001`；同时把该来源加入本机 `.env` 的 `FRONTEND_ORIGIN` 并重启 API。

## 10. 从可信数据包恢复业务数据

### 10.1 导出端先准备 ZIP

在已有数据的环境中，管理员可在“管理控制台 → 数据管理”点击“导出当前包”，也可从仓库根执行：

```bash
.venv/bin/python scripts/export_dashboard_data.py --zip
```

交付前记录 ZIP 文件名、生成时间、包版本和 Manifest 中各数据集数量。通过受控方式传给新环境，不要重新解压、编辑后再压缩。

包内必须包含 Manifest 和 5 个标准数据集；只有 Manifest 声明 matching baseline 可用时才会包含 `matching_baseline.json`。ZIP 不包含用户、审计、自定义情报、邮件配置、资格名单、`.env` 或 LLM 密钥。

### 10.2 新 Clone 用管理页导入

1. 按第 8 节启动已构建的 FastAPI，或按第 9 节启动两个开发服务。
2. 用新环境 `.env` 中的管理员账号登录。
3. 进入 `/admin`，找到“数据管理”。
4. 点击“选择 ZIP 预览”，选择交付的可信 ZIP。
5. 核对包版本、生成时间、招采期间、招采数量、App 更新期间/数量和 AI 分析状态。
6. 如果出现警告，先判断是否符合交接预期；不要在不理解警告时直接导入。
7. 预览有效后点击“确认导入”。
8. 等待“导入成功”提示，确认卡片显示“当前：导入包”或 imported 来源正在使用。
9. 分别打开招采、App 更新和 AI 页面。页面会按产品规则筛选展示，页面数字不一定等于 Manifest 全量数；管理页数据源摘要应与 Manifest 一致。

### 10.3 停止、重启并复核持久化

1. 用 `Ctrl+C` 停止 API；
2. 使用第 8 或第 9 节的同一命令重新启动；
3. 重新登录；
4. 回到“数据管理”，确认当前来源仍是“导入包”；
5. 再次打开招采/App/AI 页面，确认数据仍可读取；
6. 点击“导出当前包”，将新导出的 ZIP 再做一次预览，确认它仍有效。

导入包和 source 偏好保存在 `DASHBOARD_DATA_EXPORT_DIR`。生产 Compose 必须把其所在的 `backend/data` 持久化挂载。要恢复 live 来源，只能在管理页选择可用的“实时源”；不要手工修改 `source-preference.json`。

## 11. 外部服务与调度器按需启用

### 11.1 百度、共享 LLM 和 SMTP

初次离线交接通过后，再进入“管理控制台 → 情报技术配置”逐项配置和测试：

1. 百度搜索 API Key；
2. DeepSeek/OpenAI-compatible base URL、模型和 Key；
3. SMTP 主机、端口、SSL、用户名、发件地址和授权码。

SMTP 用户名和发件地址填写同一个有效邮箱。配置保存后再点“测试已保存配置”；连接测试只完成 SMTP 登录，不发送邮件。GET 配置只返回授权码掩码，查看完整授权码需要管理员密码二次验证。

管理页配置保存在 `USER_DB_PATH`（或独立的 `CUSTOM_INTELLIGENCE_DB_PATH`），优先于 `.env` 回退值。生产必须持久化该数据库；dashboard-data ZIP 不会恢复这些配置。

### 11.2 独立调度器

只有 API 已运行、`.env` 中 `SCHEDULER_TOKEN` 在 API 和 scheduler 侧一致、且确认允许按 cron 触发任务后，才在第三个终端执行：

```bash
.venv/bin/python -m backend.api.scheduler
```

Windows：

```powershell
.\.venv\Scripts\python.exe -m backend.api.scheduler
```

调度器是独立进程。停止 API 不会自动停止调度器，反之亦然；分别用 `Ctrl+C` 停止。

真实采集、搜索、LLM、SMTP 和完整 Pipeline 必须有明确授权、网络和凭据。离线测试通过不代表这些外部链路已经联调。

## 12. 正式脚本与入口

长期人工入口只保留在根 `scripts/`：

| 入口 | 用途 | 使用方式 |
| --- | --- | --- |
| `scripts/export_dashboard_data.py` | 无界面导出标准数据包 | 从仓库根用当前后端 Python 执行 |
| `scripts/deploy-release.ps1` | Windows 构建、发布、健康检查与回滚 | 必须显式传 `-Version` 和 `-DeployDir` |

属于业务模块的 CLI 保留在对应包内：`python -m backend.api.scheduler`、`python -m backend.broker_app_watch.cli`、`python -m backend.broker_sources.cli`。金采网、LLM 结构化和 matching 是 Pipeline 内部阶段，由 `JobCommandFactory` 以固定参数调用；日常操作优先使用管理页任务，不复制第二套包装脚本。

前端命令统一由 `frontend/package.json` 管理。依赖安装统一使用 `corepack pnpm install --frozen-lockfile`。仓库不维护重复的 `.sh`、`.cmd` 或旧平台启动包装。

## 13. Windows 生产部署

源码目录与生产运行目录分开。首次准备 `D:\broker-system`：

1. 将 `deploy/docker-compose.example.yml` 复制为 `D:\broker-system\docker-compose.yml`；
2. 将 `deploy/nginx.conf` 复制到同目录；
3. 创建生产 `.env`，设置 `BROKER_VERSION`、`BROKER_PUBLIC_URL`、管理员密码、调度 Token 和所需配置；
4. 创建 `runtime\data`、`runtime\scraper-output`、`runtime\app-watch-data`、`runtime\config`；
5. 在 `runtime\config` 放置受限的 `llm_api_config.json` 和 `user_qualification.csv`；
6. 执行 `docker compose config`，确认四服务配置能展开且没有缺失变量。

发布前确认源码分支、提交号和工作树：

```powershell
Set-Location D:\broker-announcement-system-demo
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin
git status --branch --short
```

`git status --short` 必须无输出，交付提交必须已在远端。`frontend/package.json` 版本必须等于发布版本。然后执行：

```powershell
.\scripts\deploy-release.ps1 -Version 1.7.1 -DeployDir D:\broker-system
```

脚本构建 backend/frontend 镜像，验证四个 Compose 服务，更新生产 `.env`，重建容器，检查 API、首页和 `version.json`，失败时尝试回滚。生产访问默认为 `http://localhost:8080`。不要在生产运行目录执行 `git pull`，也不要绕过脚本直接更新版本。

根 `docker-compose.yml` 只有 backend-api/backend-scheduler，适合后端开发验证；完整生产拓扑以 `deploy/docker-compose.example.yml` 为准。FastAPI 始终保持一个 worker。

## 14. 常见故障按顺序排查

- `git status --short` 刚 Clone 就有输出：确认是否 clone 到旧目录、是否运行过会改 tracked 文件的旧脚本；不要直接删除不认识的文件。
- 找不到 Python 3.11：安装 3.11 后重新创建 `.venv`，不要让 3.10/3.12 的虚拟环境冒充正式交接环境。
- pip 下载超时：保留 requirements + constraints，使用 `--timeout 300` 重试或配置公司批准的镜像；不要擅自改版本。
- `pip check` 报冲突：确认安装命令同时包含 `-r requirements.txt -c requirements-lock.txt`，并确认虚拟环境是新建的。
- frozen lockfile 失败：确认 Git 提交正确；不要在交接机上运行会改 lockfile 的安装命令。
- 后端无法启动：从仓库根运行，确认 `.env` 已创建、管理员密码已替换、8000 端口未占用；先执行 pytest 和 `pip check`。
- 前端无法连接 API：检查 `NEXT_PUBLIC_API_BASE_URL`、`FRONTEND_ORIGIN` 和端口；后端重启后需重新登录。
- 生产页面 404：确认已执行空 API Base URL 的 `pnpm build`，且 `frontend/out` 存在；再执行显式静态 smoke。
- 当前没有可用看板数据：新 Clone 的正常初始状态；导入可信 dashboard-data ZIP，不要为补历史数据直接重跑完整 Pipeline。
- 导入失败：使用系统原样导出的 ZIP，检查 Manifest/schema/hash/count、可选 baseline 和 64 MiB 限制；不要自行重打包混入数据库或密钥。
- 导入后重启丢失：检查 `DASHBOARD_DATA_EXPORT_DIR` 是否位于持久化的 `backend/data` 下，生产 Compose 是否挂载 `./runtime/data:/app/backend/data`。
- 任务返回 409：已有互斥任务或数据包操作；等待完成，或通过管理页取消对应任务。
- App Watch 配置失败：先运行 `check-config` 和 `dry-run`；dry-run 不联网，可用于区分配置问题和网络问题。
- 搜索/LLM 失败：在“情报技术配置”检查服务端 Key、模型、base URL 和连接测试；503 常见于未配置，504 为上游超时。
- 邮件失败：确认主机/端口/SSL、用户名/发件地址、授权码和网络放行；不要把授权码打印到终端或提交到 Git。
- Docker 构建或启动失败：确认 Docker Compose v2、运行目录模板和受限配置齐全，先执行 `docker compose config`，再查看四服务日志。本项目没有 Redis/Celery。

## 15. 交接完成前的最终清单

逐项打勾：

- [ ] 交付提交号与新 Clone 的 `git rev-parse HEAD` 一致，并且远端可访问；
- [ ] Python 使用 requirements + constraints 安装，`pip check` 通过；
- [ ] pnpm 使用 Corepack 9.0.0 和 frozen lockfile 安装；
- [ ] `.env` 已使用新环境的两个不同秘密值，未提交真实凭据；
- [ ] 后端 pytest、前端类型检查、lint、生产构建均退出 0；
- [ ] 显式静态 smoke 覆盖四页和 `/version.json`；
- [ ] FastAPI 单 worker 启动，health、OpenAPI、登录和四页可用；
- [ ] 首次启动/登录后的 SQLite 初始化完成，停止并重启后服务仍可用；
- [ ] 可信 ZIP 预览、导入成功，source 为 imported；
- [ ] API 重启后 imported 来源和数据仍可读取；
- [ ] 外部采集/搜索/LLM/SMTP/生产发布中未执行的项目已明确写成“未验证”；
- [ ] 母仓库执行 `git status --short` 无输出，没有把 `.env`、SQLite、ZIP、构建产物或缓存加入 Git。

## 16. 最近一次从零模拟记录

2026-08-12 对提交 `ad5dbb0` 创建了独立临时 Clone，并确认初始目录不含 `.env`、`.venv`、`frontend/node_modules` 或构建产物。本次机器没有 Python 3.11，因此使用 Python 3.12.13 做额外兼容模拟；正式推荐版本仍为 Python 3.11。

实际完成：

- requirements + constraints 从空虚拟环境安装成功，19 个锁定直接依赖全部匹配，`pip check` 通过；
- Node.js 24.17.0 + Corepack 按项目声明使用 pnpm 9.0.0，frozen lockfile 安装成功；
- 后端测试、前端类型检查、lint、空 API Base URL 生产构建和显式静态 smoke 通过；测试数量只记录在执行日志中，不作为长期文档承诺；
- FastAPI 单 worker 首次启动成功，health、OpenAPI、管理员登录、四个静态页面和 `/version.json` 可访问，用户/审计 SQLite 自动初始化；
- FastAPI 停止并重启成功；Next.js dev 与 FastAPI 双终端启动成功，四个 dev 页面可访问；
- App Watch `check-config` 和 `dry-run` 成功，未发起网络请求；
- 使用可信数据包预览无警告，导入后 source 为 imported，读取到 1,425 条招采和 69 条 App 更新；API 重启后 imported 来源、包版本和数据仍可读取。

本次未运行真实爬虫、百度搜索、LLM、SMTP、完整 Pipeline、独立 scheduler 定时触发、Docker/PowerShell 生产发布或生产网络策略验收。这些项目必须在目标环境获得明确授权后单独验证。
