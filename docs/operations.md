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
BAIDU_QIANFAN_AUTH_HEADER=Authorization
BAIDU_QIANFAN_TIMEOUT_SECONDS=120
CUSTOM_INTELLIGENCE_MAX_WORKERS=2
```

搜索接口固定为百度 `v2/ai_search/web_search`，不允许浏览器或数据库覆盖 Endpoint，默认使用 `Authorization: Bearer ...`。上线前应使用目标账号在安全环境执行管理页连接测试；如账号明确要求 `X-Appbuilder-Authorization`，只覆盖 `BAIDU_QIANFAN_AUTH_HEADER` 并重启后端。

主题与每次执行记录保存在 `USER_DB_PATH` 指向的现有数据库中；每次执行都会新建历史记录，最多保留最近 50 条。只有部署明确需要隔离时才设置 `CUSTOM_INTELLIGENCE_DB_PATH`；未配置不会生成第二个默认数据库。生产继续使用单 worker，执行状态由数据库保存，页面轮询恢复。

登录后访问 `http://localhost:3000/custom-intelligence`。自定义情报的研究深度同时决定报告整理的来源上限：简洁最多 10 条网页来源，标准最多 20 条，深度研究最多 30 条。这里的数量是搜索接口的最大返回数，实际来源数可能因时间范围、指定站点或可用结果不足而减少。深度研究本期只扩大网页来源范围并提高报告分析要求，不启用千帆另一套上游深度搜索能力；“来源偏好”仍只影响报告分析，不改变网页检索范围。建议先执行一条“简洁”即时搜索，再检查执行记录中的 request ID、来源和报告。

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
- FastAPI 保持单 worker，确保 Session、任务锁、SSE 和缓存一致。
- 网关对 HTML 和 `version.json` 使用 `no-store`，哈希静态资源使用长期缓存。

## 数据包导出

管理员可以在管理控制台“前端数据包”导出 ZIP；无界面时在仓库根目录运行：

```bash
python scripts/export_dashboard_data.py --zip
```

默认输出 `backend/data/dashboard-data/` 和同级 ZIP，正式前端通过 API 读取该目录内容。

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
- 修改 `.env` 或前端环境变量后：重启对应服务；修改正式前端后重新生成 `out/`。
