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
