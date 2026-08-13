# 安装、运行与交接操作手册

本文面向第一次接手项目、机器上没有本仓库运行环境的维护者。首次使用只需完成依赖安装、创建 `.env`、构建前端、启动 API 和一次 health 检查；完整测试、外部服务和生产部署均按需执行。

最快流程：Clone 项目 → 安装 Python/前端依赖 → 复制并修改 `.env` → 构建前端 → 启动 FastAPI → 检查 health 并登录。新 Clone 没有业务数据属于正常情况，需要时再导入可信数据包。

## 1. 开始前准备

只做本地首次启动时，准备好 Git 仓库地址以及本环境使用的管理员密码和调度 Token 即可。新 Clone 不含业务数据；需要查看真实看板内容时，再准备由本系统导出的可信 `dashboard-data.zip`。

交接边界如下：

- Git 提交负责源码、测试、文档和非敏感示例配置。
- dashboard-data ZIP 负责 5 个标准看板数据集和可选 matching baseline。
- `.env`、LLM 配置、SMTP 授权码、资格名单和 SQLite 通过受控渠道单独交付。
- 不要直接复制上一位维护者的整个开发目录；其中可能混有虚拟环境、缓存、日志和本机路径。

## 2. 准备工具

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

命令能输出版本即可继续。Python 应为 3.11.x，Node 不低于 20.9；缺少 Corepack 时，安装带 Corepack 的 Node 发行版。

## 3. Clone 项目

选择一个新的父目录，不要 clone 到旧项目目录里面。

macOS/Linux：

```bash
cd ~/work
git clone https://github.com/zzz-103/broker-announcement-system-demo.git
cd broker-announcement-system-demo
```

Windows PowerShell 示例：

```powershell
Set-Location D:\work
git clone https://github.com/zzz-103/broker-announcement-system-demo.git
Set-Location broker-announcement-system-demo
```

若这是正式交接，再用 `git rev-parse HEAD` 核对交付提交号。后续后端命令均从仓库根执行。

## 4. 创建 Python 虚拟环境并安装固定依赖

### 4.1 macOS/Linux

从仓库根执行：

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -c requirements-lock.txt
```

### 4.2 Windows PowerShell

从仓库根执行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -c requirements-lock.txt
```

安装命令退出码为 0 即可。`requirements.txt` 和 `requirements-lock.txt` 必须像上面一样同时使用。

若公司网络下载大 wheel 较慢，可以只增加读取超时后重试：

```bash
.venv/bin/python -m pip install --timeout 300 -r requirements.txt -c requirements-lock.txt
```

Windows 将 `.venv/bin/python` 换成 `.\.venv\Scripts\python.exe`。网络超时不等于依赖冲突；只有命令最终退出 0 才算安装成功。不要为绕过一次网络问题擅自修改锁定版本。

## 5. 安装前端依赖

macOS/Linux：

```bash
cd frontend
corepack pnpm install --frozen-lockfile
cd ..
```

Windows PowerShell：

```powershell
Set-Location frontend
corepack pnpm install --frozen-lockfile
Set-Location ..
```

安装命令退出码为 0 即可。必须保留 `--frozen-lockfile`；若提示 lockfile 不一致，请让代码维护者修复，不要在交接机器上重写 lockfile。

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

用文本编辑器打开根 `.env`，首次本地启动只需修改：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请替换为本环境密码
SCHEDULER_TOKEN=请替换为另一个不同的值
SCHEDULER_ENABLED=false
```

不要把上面的中文占位文本或示例 `change-me` 当作真实值。`ADMIN_PASSWORD` 与 `SCHEDULER_TOKEN` 必须不同。首次启动不运行 scheduler，待调度联调时再启用。

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

`.env`、真实资格名单、运行数据库和构建产物均不应提交到 Git。

## 7. 构建前端

首次使用无需先跑整套 pytest、类型检查、lint 或静态 smoke，直接构建前端即可。

macOS/Linux：

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL= corepack pnpm build
cd ..
```

Windows PowerShell：

```powershell
Set-Location frontend
$env:NEXT_PUBLIC_API_BASE_URL=""
corepack pnpm build
Remove-Item Env:NEXT_PUBLIC_API_BASE_URL
Set-Location ..
```

空 `NEXT_PUBLIC_API_BASE_URL` 表示静态页面与 FastAPI 同源。命令完成并生成 `frontend/out` 即可。

## 8. 启动并做最小调试

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

看到 `Application startup complete` 后，只做两项检查：

1. 打开 `http://127.0.0.1:8000/api/health`，应返回 `{"status":"ok"}`；
2. 打开 `http://127.0.0.1:8000/`，使用 `.env` 中的管理员账号登录。

若页面打不开，先在另一个终端检查 health：

```bash
curl --fail http://127.0.0.1:8000/api/health
```

Windows PowerShell：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

health 正常但页面异常时，重新执行第 7 节构建；health 也失败时，查看启动终端最后一段报错，优先检查 `.env`、依赖安装和 8000 端口占用。首次启动无需先跑整套测试。

第一次启动和登录会按需创建被忽略的 `backend/data/users.db` 和 `backend/data/audit.db`，属于正常初始化。需要接口调试时再访问 `http://127.0.0.1:8000/docs`。用 `Ctrl+C` 停止服务。

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
- frozen lockfile 失败：确认 Git 提交正确；不要在交接机上运行会改 lockfile 的安装命令。
- 后端无法启动：从仓库根运行，确认 `.env` 已创建、管理员密码已替换、8000 端口未占用，然后查看启动终端最后一段报错。
- 前端无法连接 API：检查 `NEXT_PUBLIC_API_BASE_URL`、`FRONTEND_ORIGIN` 和端口；后端重启后需重新登录。
- 页面 404：确认已按第 7 节执行前端构建且 `frontend/out` 存在，然后重启 API。
- 当前没有可用看板数据：新 Clone 的正常初始状态；导入可信 dashboard-data ZIP，不要为补历史数据直接重跑完整 Pipeline。
- 导入失败：使用系统原样导出的 ZIP，检查 Manifest/schema/hash/count、可选 baseline 和 64 MiB 限制；不要自行重打包混入数据库或密钥。
- 导入后重启丢失：检查 `DASHBOARD_DATA_EXPORT_DIR` 是否位于持久化的 `backend/data` 下，生产 Compose 是否挂载 `./runtime/data:/app/backend/data`。
- 任务返回 409：已有互斥任务或数据包操作；等待完成，或通过管理页取消对应任务。
- App Watch 配置失败：先运行 `check-config` 和 `dry-run`；dry-run 不联网，可用于区分配置问题和网络问题。
- 搜索/LLM 失败：在“情报技术配置”检查服务端 Key、模型、base URL 和连接测试；503 常见于未配置，504 为上游超时。
- 邮件失败：确认主机/端口/SSL、用户名/发件地址、授权码和网络放行；不要把授权码打印到终端或提交到 Git。
- Docker 构建或启动失败：确认 Docker Compose v2、运行目录模板和受限配置齐全，先执行 `docker compose config`，再查看四服务日志。本项目没有 Redis/Celery。

## 15. 正式交接清单

以下清单用于正式交接，不是首次本地启动的前置步骤：

- [ ] 交付提交号与新 Clone 的 `git rev-parse HEAD` 一致，并且远端可访问；
- [ ] Python 和前端依赖安装成功；
- [ ] `.env` 已使用新环境的两个不同秘密值，未提交真实凭据；
- [ ] 前端构建成功，FastAPI 单 worker 启动，health 正常且管理员可以登录；
- [ ] 可信 ZIP 预览、导入成功，source 为 imported；
- [ ] API 重启后 imported 来源和数据仍可读取；
- [ ] 外部采集/搜索/LLM/SMTP/生产发布中未执行的项目已明确写成“未验证”；
- [ ] 母仓库执行 `git status --short` 无输出，没有把 `.env`、SQLite、ZIP、构建产物或缓存加入 Git。

## 16. 历史验证说明

仓库曾在 MAC 测试环境独立临时 Clone 中完成依赖安装、前端构建、单 worker FastAPI 启动、管理员登录和数据包导入验证。该记录仅说明链路曾可用，不能代表在Windows环境中可用，不能替代当前环境的 health 与登录检查；真实爬虫、搜索、LLM、SMTP、调度器和生产发布仍须在获得授权后分别验证。
