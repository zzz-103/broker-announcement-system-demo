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

启动完整前端：

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

## 纯前端静态部署

```bash
cd frontend-coze
pnpm install
pnpm data:check
pnpm build
```

将 `frontend-coze/out/` 发布到任意静态服务器。数据包更新时，把完整目录复制到
`frontend-coze/public/dashboard-data/`，再执行 `pnpm data:check` 和 `pnpm build`。
页面使用 Hash 路由，部署在子路径时设置 `NEXT_PUBLIC_BASE_PATH=/your-path`。

## Windows 本地验证

Windows 使用与锁文件一致的 Corepack pnpm 9：

```powershell
cd <源码目录>\frontend
corepack pnpm@9.0.0 install --frozen-lockfile
.\node_modules\.bin\tsc.cmd -p tsconfig.json
.\node_modules\.bin\next.cmd build

cd ..\frontend-coze
corepack pnpm@9.0.0 install --frozen-lockfile
corepack pnpm@9.0.0 data:check
.\node_modules\.bin\tsc.cmd -p tsconfig.json
.\node_modules\.bin\next.cmd build
```

## Windows 内网发布

源码仓库和生产运行目录分开。生产发布入口是部署目录中的 `deploy-release.ps1`，不要用仓库根目录的开发 Compose 代替正式发布。

### 拉取后最快部署

以后发布新版本，直接在开发目录执行以下命令；把 `1.5.0` 替换成目标版本号即可：

```powershell
cd D:\broker-announcement-system-demo
git pull --ff-only
.\scripts\deploy-release.ps1 -Version 1.5.0 -DeployDir D:\broker-system
```

也可以使用生产目录中的转发脚本：

```powershell
cd D:\broker-system
.\deploy-release.ps1 -Version 1.5.0
```

发布脚本会校验源码已同步到 `origin/master`、构建两个镜像、更新生产 `.env` 的
`BROKER_VERSION`、重建四个服务，并检查网关健康状态和 `version.json`。因此不要在生产目录执行 `git pull`，也不要跳过脚本直接重启容器。

生产前确认：

- `.env` 已设置真实管理员密码、调度器 Token 和 LLM 配置。
- `FRONTEND_ORIGIN`、`FRONTEND_DIST_PATH` 和数据挂载目录正确。
- FastAPI 保持单 worker，确保 Session、任务锁、SSE 和缓存一致。
- 网关对 HTML 和 `version.json` 使用 `no-store`，哈希静态资源使用长期缓存。

## 数据包导出

管理员可以在完整前端导出 ZIP；无界面时在仓库根目录运行：

```bash
python scripts/export_dashboard_data.py --zip
```

默认输出 `backend/data/dashboard-data/` 和同级 ZIP。复制整个目录到纯前端后无需手工修改 JSON。

## 关键验证

```bash
./.venv/bin/python -m unittest discover -s backend/api -p 'test*.py'
cd frontend && pnpm run ts-check && pnpm run lint:build
NEXT_PUBLIC_API_BASE_URL= pnpm build
cd ../frontend-coze && pnpm data:check && pnpm ts-check && pnpm lint && pnpm build
```

真实爬虫、LLM、外部网站和 Docker 发布必须在具备相应配置的环境单独验收；本机没有生产数据时不要声称已完成真实链路验证。

## 常见问题

- 页面无法调用 API：确认 FastAPI 已启动，且 `FRONTEND_ORIGIN` 包含当前前端地址。
- 401：后端重启使旧 Token 失效，重新登录即可。
- 409：已有互斥任务或导出操作运行中。
- 纯前端数据错误：先执行 `pnpm data:check`，确认整个 `dashboard-data` 目录完整复制。
- 修改 `.env` 或前端环境变量后：重启对应服务；修改正式前端后重新生成 `out/`。
