# 券商招采智能分析系统运行手册

适用于 macOS 开发和 Windows 10/11 内网生产部署。生产架构只有两个常驻进程：单 worker FastAPI 与独立调度器；Next.js 仅在构建时使用。

快捷发布流程
# 1. 进入源码目录，拉取最新代码
cd D:\broker-announcement-system-demo
git pull --ff-only

# 2. 修改版本号
notepad frontend\package.json
# 将 "version": "1.3.1" 改为例如 "1.3.2"

# 3. 提交并推送版本号
git add frontend\package.json
git commit -m "release: v1.3.2"
git push

# 4. 进入正式部署目录，一键发布
cd D:\broker-system
.\deploy-release.ps1 -Version 1.3.2


## 1. Windows 首次准备

在项目根目录执行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\api\requirements.txt

cd frontend
corepack enable
pnpm install --frozen-lockfile
$env:NEXT_PUBLIC_API_BASE_URL=""
pnpm build
cd ..
```

构建成功后必须存在 `frontend\out\index.html`。生产运行不需要启动 Node.js。

复制并编辑配置：

```powershell
Copy-Item .env.example .env
notepad .env
```

关键生产配置：

```env
FRONTEND_ORIGIN=http://localhost:5000,http://<HOST_IP>:5000
FRONTEND_DIST_PATH=frontend/out
ANNOUNCEMENT_BACKUP_RETENTION=3
SCHEDULER_API_URL=http://127.0.0.1:5000
```

管理员密码、调度器 Token 和 LLM API Key 必须使用真实私密值，不得提交到 Git。Python、脚本和数据路径可以使用相对项目根目录的路径，也可按实际 Windows 路径覆盖。

## 2. Windows 生产启动

窗口一启动单 worker FastAPI：

```powershell
cd D:\broker-announcement-system-demo
.\.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 0.0.0.0 --port 5000 --workers 1
```

窗口二启动调度器：

```powershell
cd D:\broker-announcement-system-demo
.\.venv\Scripts\python.exe -m backend.api.scheduler
```

局域网用户访问：

```text
http://<HOST_IP>:5000
```

健康检查和接口文档：

```text
http://<HOST_IP>:5000/api/health
http://<HOST_IP>:5000/docs
```

禁止增加 Uvicorn worker 数量。Session Token、任务状态、任务互斥锁、SSE 和公告响应缓存均为进程内状态，多 worker 会造成状态不一致。

## 3. macOS 本地测试（当前推荐人工验收方式）

本节用于开发和人工验收，不使用生产静态托管方式。Next.js 开发服务器直接运行在 3000 端口，FastAPI 运行在 8000 端口。

首次准备：

```bash
cd /Volumes/zhuzhuxia1T/broker-announcement-system-demo
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/api/requirements.txt
cd broker-app-watch
.venv/bin/python -m pip install -e ".[dev]"
cd ../frontend
pnpm install
cd ..
```

后端：

```bash
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
```

前端：

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev
```

开发页面通常为 `http://localhost:3000`。也可以直接使用 `frontend/.env.local` 中的 `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`，无需在命令行重复设置。

后端健康检查：

```bash
curl http://127.0.0.1:8000/api/health
```

人工验收时登录前端后，在管理员控制台运行“券商 App 更新”，再打开 `http://localhost:3000/app-updates` 验证数据和交互。该任务由主后端调用 `broker-app-watch/.venv` 中的 CLI，不需要单独启动 App Watch FastAPI 或独立 scheduler。

App Watch 真实任务要求 `broker-app-watch/.venv` 和 `backend/config/llm_api_config.json` 可用，并会访问外部网站和 LLM 服务；只做界面验收时可先运行 `check-config` 与 `dry-run`。

本地测试不需要先执行 `pnpm build`。只有验证静态导出或生产托管时，才执行下面的生产构建流程。

## 4. Docker 备用部署

```powershell
docker build -f backend.Dockerfile -t broker-backend:1.3.1 .
$env:BROKER_IMAGE="broker-backend:1.3.1"
docker compose up -d
```

Compose 只启动 API 和调度器两个服务，对外端口为 5000。最终 Python 镜像包含已构建前端，不包含 Node.js 运行时。

## 5. 验证与故障排查

```powershell
.\.venv\Scripts\python.exe -m py_compile backend\api\main.py backend\api\job_manager.py backend\api\ai_analysis.py backend\llm_table\llm_client.py backend\llm_table\llm_markdown_table_builder.py
cd frontend
pnpm run ts-check
pnpm run lint:build
pnpm build
```

- 页面返回 `frontend build not found`：重新执行前端生产构建并重启 FastAPI。
- 401：FastAPI 重启后内存 Session 已失效，重新登录。
- 409：已有互斥任务或操作运行中。
- 修改 `.env` 或重新构建前端后，必须重启对应服务。
- 真实爬虫和真实 LLM 调用会访问外部服务，应在明确授权和有效配置下单独验收。

