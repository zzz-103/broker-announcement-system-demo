# 券商招采智能分析系统运行手册

适用于 macOS 开发和 Windows 10/11 内网生产部署。生产架构只有两个常驻进程：单 worker FastAPI 与独立调度器；Next.js 仅在构建时使用。

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

## 3. macOS 开发

后端：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/api/requirements.txt
.venv/bin/python -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000 --reload
```

前端：

```bash
cd frontend
pnpm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev
```

开发页面通常为 `http://localhost:3000`。生产静态构建前必须将 `NEXT_PUBLIC_API_BASE_URL` 置空，使浏览器同源访问 `/api`。

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
